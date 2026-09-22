//! `mining_queue` — candidate lines captured while reading, awaiting judgement.
//!
//! Thin, like the rest of `db`. What makes a line a candidate, what the media
//! is worth and which rows the ranker sees are all decisions taken in
//! [`crate::services::mining_queue`] and [`crate::routes::mining_queue`].
//!
//! Reading a row is not reading the line. Nothing here touches `word_days`,
//! `vocabulary` or `term_surfaces` — the encounter was counted once by ingest,
//! when the line was actually read, and a queue that counted it again would
//! inflate every coverage figure by however long the queue went unreviewed.

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

/// A word that made a line a candidate, as it was met.
///
/// Stored frozen: this is the line as it was read, and it is what the ranker
/// and the panel describe. Whether a word is *still* worth a card is a
/// different question, asked against the ledger every time the queue is listed
/// — see [`crate::services::mining_queue::pending`].
#[derive(Serialize, Deserialize, Clone)]
pub struct CandidateTerm {
    pub headword: String,
    pub reading: String,
    pub surface: String,
    pub status: String,
}

/// A row as the panel draws it.
#[derive(Serialize)]
pub struct QueueEntry {
    pub id: i64,
    pub line_id: i64,
    pub line_ts: f64,
    pub text: String,
    pub work: Option<String>,
    /// The terms that made it a candidate. Narrowed to those the ledger still
    /// has not judged before the panel sees it.
    pub terms: Vec<CandidateTerm>,
    pub has_audio: bool,
    pub has_image: bool,
    pub status: String,
    pub captured_ts: f64,
}

/// What a capture produced, on its way into the queue.
pub struct NewEntry {
    pub line_id: i64,
    pub line_ts: f64,
    pub text: String,
    pub work: Option<String>,
    pub terms_json: String,
    pub audio_path: Option<String>,
    pub image_path: Option<String>,
    pub captured_ts: f64,
}

/// Add a captured line to the queue.
///
/// `line_id` is unique and the insert ignores a collision: a source that
/// re-posts a batch it already sent must not produce a second copy of the same
/// candidate, media and all.
pub async fn insert_entry(pool: &SqlitePool, entry: &NewEntry) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR IGNORE INTO mining_queue
             (line_id, line_ts, text, work, terms_json, audio_path, image_path,
              status, captured_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .bind(entry.line_id)
    .bind(entry.line_ts)
    .bind(&entry.text)
    .bind(&entry.work)
    .bind(&entry.terms_json)
    .bind(&entry.audio_path)
    .bind(&entry.image_path)
    .bind(entry.captured_ts)
    .execute(pool)
    .await?;
    Ok(())
}

/// Pending rows, ranked first and oldest-first within the unranked tail.
///
/// `work` narrows it to one title: a queue spanning three works ranks lines
/// against each other that were never in competition.
pub async fn fetch_pending(
    pool: &SqlitePool,
    work: Option<&str>,
) -> Result<Vec<QueueEntry>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, line_id, line_ts, text, work, terms_json, audio_path, image_path,
                status, rank, rank_reason, captured_ts
           FROM mining_queue
          WHERE status = 'pending'
            AND (?1 IS NULL OR work = ?1)
          ORDER BY rank IS NULL, rank, line_ts",
    )
    .bind(work)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(to_entry).collect())
}

/// One row by id, whatever its status — the promote path needs its media paths
/// back after the panel has already listed it.
pub async fn fetch_entry(pool: &SqlitePool, id: i64) -> Result<Option<QueueEntry>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, line_id, line_ts, text, work, terms_json, audio_path, image_path,
                status, rank, rank_reason, captured_ts
           FROM mining_queue WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.as_ref().map(to_entry))
}

/// The media a row is holding, for the promote path and for deletion.
pub async fn fetch_media(
    pool: &SqlitePool,
    id: i64,
) -> Result<Option<(Option<String>, Option<String>)>, sqlx::Error> {
    let row = sqlx::query("SELECT audio_path, image_path FROM mining_queue WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| (r.get("audio_path"), r.get("image_path"))))
}

/// Mark a row resolved. `status` is `promoted` or `discarded`.
///
/// The row stays rather than being deleted, so a second promote of the same
/// line cannot happen and the panel can say what became of a candidate. The
/// media files are removed separately — the caller knows whether they were
/// consumed or abandoned.
pub async fn resolve(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    now: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE mining_queue
            SET status = ?, resolved_ts = ?, audio_path = NULL, image_path = NULL
          WHERE id = ? AND status = 'pending'",
    )
    .bind(status)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// One word's place in the model's ordering.
pub struct WordRank {
    pub entry_id: i64,
    pub headword: String,
    pub reading: String,
    pub rank: i64,
    pub reason: String,
}

/// Replace the ranking wholesale.
///
/// Cleared first, so a re-rank is the model's whole answer rather than the new
/// answer laid over whatever the last one said — a candidate it has since
/// decided to leave out must lose its place, not keep the old one.
pub async fn save_ranking(pool: &SqlitePool, ranked: &[WordRank]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM mining_queue_ranks")
        .execute(&mut *tx)
        .await?;
    for r in ranked {
        sqlx::query(
            "INSERT OR REPLACE INTO mining_queue_ranks
                 (entry_id, headword, reading, rank, reason)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(r.entry_id)
        .bind(&r.headword)
        .bind(&r.reading)
        .bind(r.rank)
        .bind(&r.reason)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The whole ranking, for the listing to match its candidates against.
pub async fn fetch_ranking(
    pool: &SqlitePool,
) -> Result<std::collections::HashMap<(i64, String, String), (i64, Option<String>)>, sqlx::Error> {
    let rows = sqlx::query("SELECT entry_id, headword, reading, rank, reason FROM mining_queue_ranks")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .map(|r| {
            (
                (r.get("entry_id"), r.get("headword"), r.get("reading")),
                (r.get("rank"), r.get("reason")),
            )
        })
        .collect())
}

/// Resolve every pending row at once, for the clear button.
///
/// `discarded` rather than a delete, for the same reason a single discard is:
/// the row is what stops a line being captured into the queue twice.
pub async fn discard_all_pending(pool: &SqlitePool, now: f64) -> Result<u64, sqlx::Error> {
    let done = sqlx::query(
        "UPDATE mining_queue
            SET status = 'discarded', resolved_ts = ?, audio_path = NULL, image_path = NULL
          WHERE status = 'pending'",
    )
    .bind(now)
    .execute(pool)
    .await?;
    Ok(done.rows_affected())
}

fn to_entry(row: &sqlx::sqlite::SqliteRow) -> QueueEntry {
    let terms_json: String = row.get("terms_json");
    let audio: Option<String> = row.get("audio_path");
    let image: Option<String> = row.get("image_path");
    QueueEntry {
        id: row.get("id"),
        line_id: row.get("line_id"),
        line_ts: row.get("line_ts"),
        text: row.get("text"),
        work: row.get("work"),
        terms: serde_json::from_str(&terms_json).unwrap_or_default(),
        has_audio: audio.is_some(),
        has_image: image.is_some(),
        status: row.get("status"),
        captured_ts: row.get("captured_ts"),
    }
}
