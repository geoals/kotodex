//! Capturing a line's media while it can still be captured.
//!
//! The queue's whole reason to exist: the ring buffer holds a few minutes of
//! audio and a screenshot is only of what is on screen now, so a line judged
//! worth mining an hour later has no media left to attach. This runs at read
//! time, keeps the two perishable things, and decides nothing.
//!
//! **Reading a candidate is not reading the line.** The encounter was counted
//! by [`crate::ingest`] when the text arrived; nothing here writes to
//! `word_days`, `vocabulary` or `term_surfaces`. The analysis is the
//! highlighter's read-only pass, the same one `#tokenize` answers with.

use std::collections::HashMap;
use std::sync::Arc;

use jp_core::knowledge::vocabulary::{self, Status, Term};
use serde::Serialize;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use crate::app::AppState;
use crate::clock::now_ts;
use crate::db::{self, CandidateTerm};
use crate::routes::reader::highlight;
use crate::services::capture;

/// One capture at a time.
///
/// Two screenshot tools running together fight over the display, and two ring
/// extractions read the same segments for no gain. Reading produces lines
/// faster than a capture finishes, so without this a fast scene would start a
/// process per line.
static CAPTURE_SLOT: Semaphore = Semaphore::const_new(1);

/// Past this a candidate is not worth capturing: the ring no longer holds the
/// line's audio, so all that is left is a screenshot of whatever is on screen
/// now — which is a different scene.
const MAX_LINE_AGE_SECS: f64 = 240.0;

/// Queue any of these lines that hold a word the ledger has not judged.
///
/// Spawned by the ingest route and awaited by nothing: a capture takes seconds
/// and the source is waiting on the insert, not on this. Every failure is a
/// log line — a line that missed its capture is a card not offered, never a
/// line not read.
pub fn capture_candidates(state: AppState, lines: Vec<(i64, f64, String, Option<String>)>) {
    tokio::spawn(async move {
        for (line_id, ts, text, work) in lines {
            if now_ts() - ts > MAX_LINE_AGE_SECS {
                continue;
            }
            if let Err(e) = capture_one(&state, line_id, ts, &text, work.as_deref()).await {
                warn!(line_id, error = %e, "mining queue capture failed");
            }
        }
    });
}

async fn capture_one(
    state: &AppState,
    line_id: i64,
    ts: f64,
    text: &str,
    work: Option<&str>,
) -> Result<(), String> {
    let Some(h) = highlight::shared(state).await else {
        return Ok(());
    };
    let terms = candidate_terms(&state.knowledge, &h, text).await;
    if terms.is_empty() {
        return Ok(());
    }

    // Held across the capture, not just the spawn: the point is that only one
    // screenshot is being taken at a time.
    let _slot = CAPTURE_SLOT.acquire().await.map_err(|e| e.to_string())?;

    // Re-checked after the wait. A queue backed up behind a long capture can
    // leave a line's audio out of the ring by the time its turn comes, and a
    // screenshot taken then belongs to a scene several lines later.
    if now_ts() - ts > MAX_LINE_AGE_SECS {
        return Ok(());
    }

    let outdir = state.queue_media_dir.join(line_id.to_string());
    let result = capture::run(
        state,
        capture::Target {
            anchor_ts: Some(ts),
            note_id: None,
            mode: capture::Mode::Pool(outdir),
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let audio = result
        .get("audio")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let image = result
        .get("image")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    if audio.is_none() && image.is_none() {
        return Ok(());
    }

    let entry = db::NewQueueEntry {
        line_id,
        line_ts: ts,
        text: text.to_string(),
        work: work.map(str::to_string),
        terms_json: serde_json::to_string(&terms).unwrap_or_else(|_| "[]".into()),
        audio_path: audio,
        image_path: image,
        captured_ts: now_ts(),
    };
    db::insert_queue_entry(&state.local, &entry)
        .await
        .map_err(|e| e.to_string())?;
    info!(line_id, terms = terms.len(), "queued a mining candidate");
    Ok(())
}

/// The words in a line the ledger has never been told about.
///
/// `new` and `unknown` only. `seen` is a word the ledger has met and not been
/// asked about, which is the triage sweep's job rather than this one's, and
/// `known` is settled.
async fn candidate_terms(
    knowledge: &jp_core::knowledge::Knowledge,
    h: &Arc<highlight::Highlighter>,
    text: &str,
) -> Vec<CandidateTerm> {
    highlight::analyze(knowledge, h, text)
        .await
        .into_iter()
        .filter(|t| matches!(t.status, Some("new") | Some("unknown")))
        .map(|t| CandidateTerm {
            headword: t.headword,
            reading: t.reading,
            surface: t.surface,
            status: t.status.unwrap_or("new").to_string(),
        })
        .collect()
}

/// One row per *word* — the word, and the best line it was met in.
///
/// The queue captures lines, but a card is for a word, and the same word turns
/// up in several lines of one session. Listing each line separately asks the
/// same question over and over.
#[derive(Serialize)]
pub struct Candidate {
    /// The queue row the chosen line came from. What a promote acts on.
    pub id: i64,
    pub headword: String,
    pub reading: String,
    pub surface: String,
    pub status: String,
    pub text: String,
    pub work: Option<String>,
    pub line_ts: f64,
    /// How many *other* unjudged words share this line. A line carrying
    /// several is a poor line to meet any one of them in, so it is shown and
    /// ranked accordingly rather than hidden.
    pub competing: usize,
    pub rank: Option<i64>,
    pub rank_reason: Option<String>,
}

/// Pending candidates, with every word the ledger has since judged taken out,
/// one row per word.
///
/// The stored word list is what the line held when it was read and never
/// changes. What a candidate is *worth* does: marking a word known is the
/// normal way to answer "should I make a card for this", and the queue has to
/// hear that answer. A word whose every line has been judged is not offered.
///
/// Derived on read rather than written back, because the judgement undoes: a
/// word ticked known by mistake and corrected brings its candidate back.
///
/// The badge and the panel both come through here, or the header would count
/// rows the page then declines to draw.
pub async fn pending(
    state: &AppState,
    work: Option<&str>,
) -> Result<Vec<Candidate>, sqlx::Error> {
    let mut entries = db::fetch_pending_queue(&state.local, work).await?;

    let terms: Vec<Term> = entries
        .iter()
        .flat_map(|e| &e.terms)
        .map(|t| Term::new(&t.headword, &t.reading))
        .collect();
    let rows = vocabulary::fetch_many(&state.knowledge, &terms).await?;
    // The same substitution the reader makes: a word judged under one of its
    // readings is judged, or 空/そら marked known would leave 空/から here
    // looking unasked.
    let headwords: Vec<String> = terms.iter().map(|t| t.headword.clone()).collect();
    let known_elsewhere = vocabulary::known_readings(&state.knowledge, &headwords).await?;

    for entry in &mut entries {
        entry.terms.retain(|t| {
            let judged_here = rows
                .get(&Term::new(&t.headword, &t.reading))
                .map(|r| settled(r.status))
                .unwrap_or(false);
            !judged_here && !known_elsewhere.contains_key(&t.headword)
        });
    }

    let ranking = db::fetch_queue_ranking(&state.local).await?;

    let mut best: HashMap<(String, String), Candidate> = HashMap::new();
    for entry in entries {
        let competing = entry.terms.len().saturating_sub(1);
        for t in &entry.terms {
            let placed = ranking.get(&(entry.id, t.headword.clone(), t.reading.clone()));
            let candidate = Candidate {
                id: entry.id,
                headword: t.headword.clone(),
                reading: t.reading.clone(),
                surface: t.surface.clone(),
                status: t.status.clone(),
                text: entry.text.clone(),
                work: entry.work.clone(),
                line_ts: entry.line_ts,
                competing,
                rank: placed.map(|(r, _)| *r),
                rank_reason: placed.and_then(|(_, why)| why.clone()),
            };
            best
                .entry((t.headword.clone(), t.reading.clone()))
                .and_modify(|held| {
                    if beats(&candidate, held) {
                        *held = Candidate { ..clone_of(&candidate) };
                    }
                })
                .or_insert(candidate);
        }
    }

    let mut out: Vec<Candidate> = best.into_values().collect();
    out.sort_by(|a, b| {
        (a.rank.is_none(), a.rank, a.competing, a.line_ts as i64).cmp(&(
            b.rank.is_none(),
            b.rank,
            b.competing,
            b.line_ts as i64,
        ))
    });
    Ok(out)
}

/// Which of two lines is the better place to meet the same word.
///
/// Fewest competing words first — a line teaching one thing beats a line
/// teaching three — then the model's ranking if it has run, then the earliest
/// sighting, so the answer does not move about between loads.
fn beats(new: &Candidate, held: &Candidate) -> bool {
    (new.competing, new.rank.unwrap_or(i64::MAX), new.line_ts as i64)
        < (
            held.competing,
            held.rank.unwrap_or(i64::MAX),
            held.line_ts as i64,
        )
}

fn clone_of(c: &Candidate) -> Candidate {
    Candidate {
        id: c.id,
        headword: c.headword.clone(),
        reading: c.reading.clone(),
        surface: c.surface.clone(),
        status: c.status.clone(),
        text: c.text.clone(),
        work: c.work.clone(),
        line_ts: c.line_ts,
        competing: c.competing,
        rank: c.rank,
        rank_reason: c.rank_reason.clone(),
    }
}

/// Whether the ledger has an answer that makes a card pointless.
///
/// `unknown` is not settled — it is the reader saying they looked and did not
/// know it, which is the strongest case for a card there is. `new` is settled
/// by nothing at all.
fn settled(status: Status) -> bool {
    !matches!(status, Status::New | Status::Unknown)
}

/// How much the backlog is holding, so the clear button can name it before it
/// throws it away.
///
/// Walked rather than summed from the rows: the files are the thing being
/// deleted, and a row whose media went missing must not make the figure lie.
pub async fn media_size(dir: &std::path::Path) -> (u64, u64) {
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut items = 0;
        let mut bytes = 0;
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return (0, 0);
        };
        for line_dir in entries.flatten() {
            let Ok(files) = std::fs::read_dir(line_dir.path()) else {
                continue;
            };
            let mut had_any = false;
            for f in files.flatten() {
                if let Ok(meta) = f.metadata() {
                    bytes += meta.len();
                    had_any = true;
                }
            }
            if had_any {
                items += 1;
            }
        }
        (items, bytes)
    })
    .await
    .unwrap_or((0, 0))
}

/// Empty the media store. Answers whether it is actually gone.
pub async fn remove_all_media(dir: &std::path::Path) -> bool {
    match tokio::fs::remove_dir_all(dir).await {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => {
            warn!(path = %dir.display(), error = %e, "could not clear the queue media");
            false
        }
    }
}

/// Delete a candidate's media, whether it was used or abandoned.
///
/// The directory goes with the files: one per line id, so nothing else is in
/// it, and leaving thousands of empty directories behind is its own mess.
pub async fn remove_media(dir: &std::path::Path, line_id: i64) {
    let path = dir.join(line_id.to_string());
    if let Err(e) = tokio::fs::remove_dir_all(&path).await
        && e.kind() != std::io::ErrorKind::NotFound
    {
        warn!(path = %path.display(), error = %e, "could not remove queue media");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(competing: usize, rank: Option<i64>, line_ts: f64) -> Candidate {
        Candidate {
            id: 1,
            headword: "口枷".into(),
            reading: "くちかせ".into(),
            surface: "口枷".into(),
            status: "new".into(),
            text: "line".into(),
            work: None,
            line_ts,
            competing,
            rank,
            rank_reason: None,
        }
    }

    #[test]
    fn a_line_teaching_one_word_beats_a_line_teaching_three() {
        assert!(beats(&candidate(0, None, 20.0), &candidate(2, None, 10.0)));
    }

    #[test]
    fn the_models_ranking_breaks_a_tie_on_competing_words() {
        assert!(beats(
            &candidate(1, Some(2), 30.0),
            &candidate(1, Some(9), 10.0)
        ));
    }

    #[test]
    fn an_unranked_line_loses_to_a_ranked_one() {
        assert!(!beats(&candidate(1, None, 5.0), &candidate(1, Some(40), 90.0)));
    }

    #[test]
    fn the_earliest_sighting_settles_it_so_the_answer_does_not_move() {
        assert!(beats(&candidate(1, None, 10.0), &candidate(1, None, 20.0)));
    }
}
