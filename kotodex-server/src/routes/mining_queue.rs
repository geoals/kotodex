//! `#queue` — the candidates reading captured, and what becomes of them.
//!
//! The queue is reviewed away from the reader on purpose. Deciding which word
//! is worth a card is the judgement the capture exists to defer; putting it
//! back on screen while reading would reintroduce exactly the interruption the
//! feature removes.
//!
//! Two writes and two reads. Listing and ranking change nothing; promoting
//! builds the card and hands it to [`crate::services::card::add_note`], which
//! every card path calls, and discarding resolves the row. Neither touches the
//! ledger: a candidate reviewed here was already read once, and counting it
//! again would inflate every coverage figure by however long the queue sat.

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::{Json, body::Bytes};
use jp_mine_core::llm::Ask;
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;

use crate::app::AppState;
use crate::clock::now_ts;
use crate::db;
use crate::error::AppError;
use crate::routes::reader::mine::{MineRequest, added, build_note};

/// The model reads a line and its unjudged words and says which lines are worth
/// a card. It is given no frequency data on purpose: the ranks are already on
/// the page, and a model shown them ranks by them instead of by the sentence.
const RANK_SYSTEM: &str = "\
You choose which words a Japanese learner should turn into flashcards.\n\n\
You are given candidates from one reading session: a word the learner did not \
know, and the line it was met in.\n\n\
**Take that at face value.** This reader marks words known as they read, so a \
word reaching you is one they could not read or were unsure of. \n\n\
Judge two things together: whether the word is worth knowing beyond this \
text, and whether the sentence is a good place to meet it — short, in plain \
form, understandable without the surrounding scene.\n\n\
`other_new_words_in_line` counts the other unjudged words in the same \
sentence. Rank those lower: a sentence the reader cannot yet read the rest of \
teaches none of its words well, and the count rising is the clearest sign of \
it.\n\n\
Leave out only what is not a word. The tokenizer cuts things that are not \
vocabulary: a piece sliced out of a longer run of kana, or a noise written \
down — a moan, a sound effect. The test is whether it would look wrong as the front of a \
card on its own.\n\n\
**Omit those entirely — leave them out of the list. Do not rank them at the \
bottom.** If you find yourself writing that something is not a word, not \
vocabulary, or a fragment, that is the signal to drop it rather than place it \
last.\n\n\
`why` is about the **word**, and nothing else. The reader already sees the \
sentence and the count of competing words next to it, so repeating either \
tells them nothing they are not looking at. Say what kind of word it is and \
where it earns its place: the register it belongs to, what it is opaque from, \
who says it and when. Commonness counts when you say where — 'everywhere in \
dialogue, absent from textbooks' places a word; 'common' alone does not.\n\n\
Never mention the sentence, its length, its clarity, or how many other unknown \
words are in it. Those decide the ranking; they are not what you write down.\n\n\
Good: 'idiom, opaque from its parts'. 'everywhere in dialogue, never in \
textbooks'. 'clinical register, turns up in any medical scene'. 'abstract \
noun, carries into essays'.\n\
Bad: 'useful word'. 'good to know'. 'plain sentence, no other unknowns'. \
'common' with nothing after it.\n\n\
Answer with JSON only: {\"ranked\": [{\"id\": <candidate id>, \"why\": \"<at most 12 words>\"}]}. \
Best first. Omit the candidates you are leaving out.";

const RANK_MODEL: &str = "claude-sonnet-5";
const RANK_MAX_TOKENS: u32 = 4000;

#[derive(Deserialize)]
pub struct ListQuery {
    /// One work at a time. A queue spanning three of them ranks lines against
    /// each other that were never in competition.
    pub work: Option<String>,
}

/// `GET /api/queue`
pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let entries = crate::services::mining_queue::pending(&state, q.work.as_deref()).await?;
    let settings = db::load_settings(&state.local).await?;
    let (items, bytes) = crate::services::mining_queue::media_size(&state.queue_media_dir).await;
    Ok(Json(json!({
        "entries": entries,
        "capture_on": settings.pool_capture,
        "backlog_items": items,
        "backlog_bytes": bytes,
    })))
}

/// `GET /api/queue/count` — what the dashboard badge reads.
///
/// Its own endpoint because it is polled by a page that wants nothing else:
/// the queue is worthless if nobody remembers it is there, and the badge is
/// the only thing that remembers.
///
/// Counted through the same filter the panel lists with, never with SQL of its
/// own: a badge saying 14 over a page drawing 3 is worse than no badge.
pub async fn count(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let pending = crate::services::mining_queue::pending(&state, None).await?.len();
    Ok(Json(json!({ "pending": pending })))
}

/// `GET /api/queue/{id}/media/{kind}` — the screenshot or the clip.
///
/// The audio is served as the raw PCM it was saved as, which no browser plays;
/// the panel offers the picture and the word list, and the clip is judged at
/// promotion by the card it lands on. Encoding it here would mean an ffmpeg per
/// row drawn.
pub async fn media(
    State(state): State<AppState>,
    Path((id, kind)): Path<(i64, String)>,
) -> Result<axum::response::Response, AppError> {
    let Some((audio, image)) = db::fetch_queue_media(&state.local, id).await? else {
        return Err(AppError::BadRequest("no such queue entry".into()));
    };
    let (path, mime) = match kind.as_str() {
        "image" => (image, "image/png"),
        "audio" => (audio, "application/octet-stream"),
        _ => return Err(AppError::BadRequest("kind is image or audio".into())),
    };
    let Some(path) = path else {
        return Err(AppError::BadRequest("that entry has no such media".into()));
    };
    // Confined to the media directory: the column is written by this server,
    // but it is still a path from the database being opened by a request.
    if !std::path::Path::new(&path).starts_with(&state.queue_media_dir) {
        return Err(AppError::BadRequest("media path is outside the store".into()));
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| AppError::Upstream(format!("media unreadable: {e}")))?;
    Ok(([(axum::http::header::CONTENT_TYPE, mime)], bytes).into_response())
}

/// `POST /api/queue/rank` — ask the model to order what is pending.
pub async fn rank(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, AppError> {
    let Some(provider) = crate::services::llm::provider(&state).await? else {
        return Err(AppError::BadRequest("no API key is set".into()));
    };
    let entries = crate::services::mining_queue::pending(&state, q.work.as_deref()).await?;
    if entries.is_empty() {
        return Ok(Json(json!({ "ranked": 0 })));
    }

    // The id the model answers with is a position in this listing, not a
    // database id: one candidate is a word *in* a line, and the row id alone
    // cannot tell two words of the same line apart.
    let listing: Vec<Value> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            json!({
                "id": i + 1,
                "word": e.headword,
                "reading": e.reading,
                "line": e.text,
                "other_new_words_in_line": e.competing,
            })
        })
        .collect();
    let messages = vec![json!({
        "role": "user",
        "content": serde_json::to_string_pretty(&listing).unwrap_or_default(),
    })];
    let answer = provider
        .complete(
            &state.http,
            &Ask {
                system: RANK_SYSTEM,
                messages: &messages,
                max_tokens: RANK_MAX_TOKENS,
                default_model: RANK_MODEL,
                cache_system: false,
            },
        )
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;

    let placed = parse_ranking(&answer);
    let ranked: Vec<db::WordRank> = placed
        .into_iter()
        .filter_map(|(listed, _, reason)| {
            // A position the model invented names no candidate, so it ranks
            // nothing — better than moving the ranking onto a word it was not
            // talking about.
            let e = entries.get(listed.checked_sub(1)?)?;
            Some((e, reason))
        })
        // Numbered after the drops, not before: a position the model invented
        // must not leave a hole in what the reader is shown.
        .enumerate()
        .map(|(i, (e, reason))| db::WordRank {
            entry_id: e.id,
            headword: e.headword.clone(),
            reading: e.reading.clone(),
            rank: i as i64 + 1,
            reason,
        })
        .collect();
    if ranked.is_empty() {
        return Err(AppError::Upstream(
            "the model returned no usable ranking".into(),
        ));
    }
    let count = ranked.len();
    db::save_queue_ranking(&state.local, &ranked).await?;
    Ok(Json(json!({ "ranked": count })))
}

/// Pull `{"ranked": [{"id", "why"}]}` out of the reply as
/// `(listed position, rank, why)`.
///
/// The rank is where the model put the line, not a number it was asked to
/// write: a model that numbers its own list eventually skips or repeats one,
/// and the order is the answer either way.
fn parse_ranking(answer: &str) -> Vec<(usize, i64, String)> {
    let start = answer.find('{');
    let end = answer.rfind('}');
    let (Some(start), Some(end)) = (start, end) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&answer[start..=end]) else {
        return Vec::new();
    };
    let Some(items) = parsed.get("ranked").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(i, item)| {
            let id = item.get("id").and_then(Value::as_u64)? as usize;
            let why = item
                .get("why")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some((id, i as i64 + 1, why))
        })
        .collect()
}

/// The one sentence of a hooked line that holds the mined word.
///
/// A text box routinely carries two, and a card wants the one its word is in —
/// the overlay scopes its own by the click offset, and this has the picked
/// word's spelling to find instead. The audio follows the same field:
/// `vn-trim.py` cuts the clip to whatever Sentence says, so a line left whole
/// here buys a clip spanning both.
///
/// A surface the line does not contain leaves the line whole, which is the
/// only honest answer — the alternative is guessing a boundary.
fn sentence_for(line: &str, surface: &str) -> String {
    match line.find(surface) {
        Some(at) => jp_core::text::sentences::sentence_at(line, at).to_string(),
        None => line.to_string(),
    }
}

#[derive(Deserialize)]
pub struct PromoteBody {
    /// Which of the line's candidate words the card is for. The queue holds a
    /// line, not a word — the reader picks one at promotion, which is the
    /// decision the whole feature exists to defer.
    pub term: String,
    pub reading: String,
    pub surface: String,
}

/// `POST /api/queue/{id}/promote` — turn a candidate into a card.
pub async fn promote(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<PromoteBody>,
) -> Result<Json<Value>, AppError> {
    let Some(entry) = db::fetch_queue_entry(&state.local, id).await? else {
        return Err(AppError::BadRequest("no such queue entry".into()));
    };
    if entry.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "that candidate was already {}",
            entry.status
        )));
    }
    let Some((audio, image)) = db::fetch_queue_media(&state.local, id).await? else {
        return Err(AppError::BadRequest("no such queue entry".into()));
    };

    let sentence = sentence_for(&entry.text, &body.surface);
    let note = build_note(
        &state,
        &MineRequest {
            term: body.term,
            reading: body.reading,
            surface: body.surface,
            sentence,
            work: entry.work.clone().unwrap_or_default(),
        },
    )
    .await?;
    let body_bytes =
        Bytes::from(serde_json::to_vec(&note).map_err(|e| AppError::Upstream(e.to_string()))?);

    // The same seam every card goes through, told only that its media was cut
    // when the line was read rather than a moment ago.
    let (_status, replied) = crate::services::card::add_note_with(
        &state,
        body_bytes,
        crate::services::card::CaptureSource::Saved {
            clip: audio,
            image,
            line_text: entry.text.clone(),
        },
    )
    .await
    .map_err(AppError::Upstream)?;

    let result = added(&replied);
    // Resolved only on a card that exists. A duplicate or a refusal leaves the
    // row pending with its media intact, which is the only state from which the
    // promote can be tried again.
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        db::resolve_queue_entry(&state.local, id, "promoted", now_ts()).await?;
        // The capture is detached and still reading these files, so they are
        // left for the retention sweep rather than removed under it.
    }
    Ok(Json(result))
}

/// `POST /api/queue/{id}/discard`
///
/// Writes no ledger row. "I do not want a card for this" is not the assertion
/// "I do not know this word", and a discard that quietly wrote `unknown` would
/// corrupt the one thing triage exists to measure.
pub async fn discard(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let Some(entry) = db::fetch_queue_entry(&state.local, id).await? else {
        return Err(AppError::BadRequest("no such queue entry".into()));
    };
    db::resolve_queue_entry(&state.local, id, "discarded", now_ts()).await?;
    crate::services::mining_queue::remove_media(&state.queue_media_dir, entry.line_id).await;
    Ok(Json(json!({ "ok": true })))
}

/// `POST /api/queue/clear` — throw the whole backlog away.
///
/// One button rather than a retention rule. The queue is a shortlist reviewed
/// in one sitting; what survives that sitting is not a thing to age out on a
/// timer, it is a thing to clear when you are done with it.
///
/// Writes no ledger row, exactly as a discard does not: clearing is "I am done
/// with this list", not an answer about any word in it.
pub async fn clear(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let cleared = db::discard_all_pending(&state.local, now_ts()).await?;
    let removed = crate::services::mining_queue::remove_all_media(&state.queue_media_dir).await;
    if !removed {
        warn!("cleared the queue but some media could not be deleted");
    }
    Ok(Json(json!({ "cleared": cleared })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rank_is_the_position_not_what_the_model_numbered() {
        let answer = r#"here you go:
        {"ranked": [{"id": 7, "why": "clean sentence"}, {"id": 3, "why": "idiom"}]}"#;
        let ranked = parse_ranking(answer);
        assert_eq!(ranked[0], (7, 1, "clean sentence".to_string()));
        assert_eq!(ranked[1], (3, 2, "idiom".to_string()));
        assert_eq!(ranked.len(), 2);
    }

    #[test]
    fn a_card_gets_the_sentence_its_word_is_in() {
        let line = "俺の世界は、決定的に変容した。何もかもがどうでもよかったあの灰色の、無感動な世界に、既に俺はいない";
        assert_eq!(
            sentence_for(line, "無感動"),
            "何もかもがどうでもよかったあの灰色の、無感動な世界に、既に俺はいない"
        );
        assert_eq!(sentence_for(line, "変容"), "俺の世界は、決定的に変容した。");
    }

    #[test]
    fn a_word_the_line_does_not_hold_leaves_it_whole() {
        let line = "今日は暑い。明日は寒い。";
        assert_eq!(sentence_for(line, "猫"), line);
    }

    #[test]
    fn an_unparseable_reply_ranks_nothing() {
        assert!(parse_ranking("I could not decide.").is_empty());
    }
}
