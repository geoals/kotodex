//! The primer — what to learn before a video, rather than what was said in it.
//!
//! **Repetition is the topic-detection rule.** A content word that recurs
//! inside one video and is not already known is a topic word by construction,
//! because a programme's domain vocabulary repeats when the programme is about
//! it. So no frequency threshold gates the list: one would cut 政策 and 財政,
//! which are exactly the words worth priming on. Frequency is the *sort*.
//!
//! Both ranks travel. The two corpora disagree hardest on this genre — 財源 is
//! 3,786 in BCCWJ and 47,569 in Jiten — and a word common in either is one
//! worth seeing, which is the same rule `jp_core::highlight` keeps them for.
//!
//! The threshold and the ordering are the client's, over one fetch: every
//! not-known word ships once, so moving the slider costs no request.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use jp_core::highlight;
use jp_core::knowledge::vocabulary::{self, Status, Term};
use jp_core::tokenize::is_content_word;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::app::AppState;
use crate::db;
use crate::error::AppError;
use crate::models::{PrimerMinute, PrimerWord, Sentence};
use crate::routes::mining::format_seconds;
use crate::services::media::media_filenames;

fn worth_priming(status: Status) -> bool {
    matches!(status, Status::New | Status::Unknown)
}

fn tier_worth_priming(tier: &str) -> bool {
    matches!(tier, "new" | "seen" | "unknown")
}

async fn build(state: &AppState, job_id: i64) -> Result<(), AppError> {
    let Some(h) = &state.highlighter else {
        return Err(AppError::Upstream(
            "the tokenizer is unavailable — check the Sudachi dictionary".into(),
        ));
    };
    let sentences = db::get_sentences_for_job(&state.db, job_id).await?;

    let mut words: HashMap<(String, String), PrimerWord> = HashMap::new();
    let mut minutes: HashMap<i64, i64> = HashMap::new();

    for s in &sentences {
        let minute = (s.start_time / 60.0) as i64;
        for a in highlight::analyze(&state.knowledge, h, &s.text).await {
            let Some(tier) = a.status else { continue };
            if !is_content_word(&a.pos) {
                continue;
            }
            // Known words count too: the curve is a share of what was spoken,
            // not of what was hard.
            *minutes.entry(minute).or_insert(0) += 1;
            if !tier_worth_priming(tier) {
                continue;
            }
            // The reading the verdict actually came from, which is what the
            // transcript view keys on. Keying differently would make the two
            // disagree about what 空 is.
            let reading = a.judged_as.unwrap_or(a.reading);
            words
                .entry((a.headword.clone(), reading.clone()))
                .and_modify(|w| {
                    w.count += 1;
                    w.times.push(s.start_time);
                })
                .or_insert_with(|| PrimerWord {
                    headword: a.headword,
                    reading,
                    pos: a.pos,
                    count: 1,
                    first_sentence_id: s.id,
                    first_start: s.start_time,
                    first_offset: a.start as i64,
                    first_len: a.len as i64,
                    // Stored, not re-asked per request: a rank is a fact about
                    // the dictionaries, so it moves only when one is imported.
                    // Asking live would cost two queries per word per load.
                    freq_rank: a.freq_rank,
                    bccwj_rank: a.bccwj_rank,
                    times: vec![s.start_time],
                });
        }
    }

    let mut words: Vec<_> = words.into_values().collect();
    words.sort_by(|a, b| {
        a.first_start
            .partial_cmp(&b.first_start)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.headword.cmp(&b.headword))
    });

    let mut minutes: Vec<_> = minutes
        .into_iter()
        .map(|(minute, content_tokens)| PrimerMinute {
            minute,
            content_tokens,
        })
        .collect();
    minutes.sort_by_key(|m| m.minute);

    db::replace_primer(&state.db, job_id, &words, &minutes, sentences.len() as i64).await?;
    Ok(())
}

pub async fn get_primer(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let job = db::get_job_by_video_id(&state.db, &video_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // The counts are over the whole transcript, so one that grew since the
    // build invalidates every one of them.
    let built_from = db::primer_built_for(&state.db, job.id).await?;
    let sentence_count = db::count_sentences_for_job(&state.db, job.id).await?;
    if built_from != Some(sentence_count) {
        build(&state, job.id).await?;
    }

    let stored = db::get_primer_words(&state.db, job.id).await?;
    let minutes = db::get_primer_minutes(&state.db, job.id).await?;

    let sentence_ids: Vec<i64> = stored
        .iter()
        .map(|w| w.first_sentence_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let sentences: HashMap<i64, Sentence> = db::get_sentences_by_ids(&state.db, &sentence_ids)
        .await?
        .into_iter()
        .map(|s| (s.id, s))
        .collect();

    let terms: Vec<Term> = stored
        .iter()
        .map(|w| Term::new(w.headword.clone(), &w.reading))
        .collect();
    // Asked now rather than at build time, so a word judged since is already
    // gone from the list. One query for all of them, not one per word.
    let rows = vocabulary::fetch_many(&state.knowledge, &terms).await?;

    let mut words = Vec::with_capacity(stored.len());

    for (w, term) in stored.iter().zip(terms.iter()) {
        let Some(sentence) = sentences.get(&w.first_sentence_id) else {
            continue;
        };
        let (status, encounter_count) = match rows.get(term) {
            // Met for the first time in this very transcript, with ingest not
            // yet caught up.
            None => (Status::New, 0),
            Some(row) if row.mined => continue,
            Some(row) => (row.status, row.encounter_count),
        };
        if !worth_priming(status) {
            continue;
        }

        words.push(json!({
            "headword": w.headword,
            "reading": w.reading,
            "pos": w.pos,
            "count": w.count,
            "status": status.as_str(),
            "encounter_count": encounter_count,
            "freq_rank": w.freq_rank,
            "bccwj_rank": w.bccwj_rank,
            "times": w.times,
            "first": {
                "sentence_id": sentence.id,
                "start_seconds": sentence.start_time as u64,
                "timestamp": format_seconds(sentence.start_time),
                // UTF-16 offsets, which is what a JavaScript string is indexed
                // in — the row slices the sentence at them to mark the word,
                // and the popup's expansion scan starts from the same place.
                "start": w.first_offset,
                "len": w.first_len,
                "text": sentence.text,
            },
        }));
    }

    Ok(Json(json!({
        "job_id": job.id,
        "video_id": video_id,
        "video_title": job.video_title,
        "not_known": words.len(),
        "minutes": minutes
            .iter()
            .map(|m| json!({ "minute": m.minute, "content_tokens": m.content_tokens }))
            .collect::<Vec<_>>(),
        "words": words,
    })))
}

/// A still frame from the moment a word was first said, cut on demand and kept
/// exactly as the audio clip is.
///
/// `video_path` is absent until the video download lands, which is after the
/// audio — transcription only needs the audio — so a miss is a 404 and a row
/// that draws without a picture, not an error.
pub async fn sentence_thumb(
    State(state): State<AppState>,
    Path((video_id, sentence_id)): Path<(String, i64)>,
) -> Result<Response, AppError> {
    let job = db::get_job_by_video_id(&state.db, &video_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let sentences = db::get_sentences_by_ids(&state.db, &[sentence_id]).await?;
    let sentence = sentences.into_iter().next().ok_or(AppError::NotFound)?;
    if sentence.job_id != job.id {
        return Err(AppError::NotFound);
    }
    let video_path = job.video_path.clone().ok_or(AppError::NotFound)?;
    // A recorded path whose file is gone is the same answer as no path at all.
    // Handing it to ffmpeg would spend a process per row to fail.
    if !tokio::fs::try_exists(&video_path).await.unwrap_or(false) {
        return Err(AppError::NotFound);
    }

    let (thumb_filename, _) = media_filenames(job.id, sentence_id);
    let thumb_path = format!("{}/{thumb_filename}", state.media_dir);

    if !tokio::fs::try_exists(&thumb_path).await.unwrap_or(false) {
        tokio::fs::create_dir_all(&state.media_dir)
            .await
            .map_err(|e| AppError::Media(format!("failed to create media dir: {e}")))?;

        let midpoint = (sentence.start_time + sentence.end_time) / 2.0;
        state
            .media_extractor
            .extract_screenshot(&video_path, midpoint, &thumb_path)
            .await
            .map_err(|e| AppError::Media(e.to_string()))?;
    }

    let bytes = tokio::fs::read(&thumb_path)
        .await
        .map_err(|e| AppError::Media(format!("failed to read thumbnail: {e}")))?;

    Ok(([(axum::http::header::CONTENT_TYPE, "image/jpeg")], bytes).into_response())
}

#[derive(Deserialize)]
pub struct TranslateBody {
    pub text: String,
}

const TRANSLATE_SYSTEM: &str = "You translate Japanese into natural English. \
Reply with the translation and nothing else — no notes, no romaji, no quotes.";

const TRANSLATE_MAX_TOKENS: u32 = 1000;

pub async fn translate(
    State(state): State<AppState>,
    Json(body): Json<TranslateBody>,
) -> Result<Json<Value>, AppError> {
    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("no text to translate".into()));
    }
    let provider = state
        .translator
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("no translation model is configured".into()))?;

    let messages = [json!({ "role": "user", "content": text })];
    let ask = jp_mine_core::llm::Ask {
        system: TRANSLATE_SYSTEM,
        messages: &messages,
        max_tokens: TRANSLATE_MAX_TOKENS,
        default_model: &provider.model,
        cache_system: false,
    };

    match provider.complete(&state.http, &ask).await {
        Ok(translation) => Ok(Json(json!({ "translation": translation.trim() }))),
        Err(jp_mine_core::llm::Error::Unavailable(e)) => Err(AppError::BadRequest(e)),
        Err(e) => Err(AppError::Upstream(e.to_string())),
    }
}
