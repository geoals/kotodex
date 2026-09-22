//! Firing `capture/vn-capture.sh`, and finding the window to point it at.
//!
//! kotodex-server does not record audio or take screenshots; `vn-capture.sh` does,
//! on the machine running the VN. This module is the boundary: build the
//! environment the script expects, run it, parse the one JSON object it prints.
//!
//! Three callers, one command: the auto-capture on card add, which every mine
//! goes through and which relies on the lookup that must have preceded it —
//! Yomitan's popup, or the overlay's — and the mining queue's two halves,
//! which split that same capture in time. [`Mode::Pool`] takes only what the
//! ring will forget; [`Mode::Resume`] does the rest later, against what Pool
//! saved.

use std::time::Duration;

use serde_json::Value;
use tracing::{info, warn};

use crate::app::AppState;
use crate::db;
use crate::error::AppError;

/// vn-capture.sh runs VAD and (usually) a whisper transcription for the
/// sentence trim, so it is slow by design. Past this it is stuck, not working.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(90);

/// What the capture is *for*, when the caller knows more than "capture now".
///
/// The mine button knows neither field — it fires against whatever line is
/// current and attaches to the last note added, which is what pressing it
/// means. The card-add path knows both and has to say so, because by the time
/// the script runs the reader may have moved on.
/// Which half of a capture to run — or, for the hotkey and the card path, both
/// at once.
///
/// The split exists because the two halves have different deadlines. Only the
/// screenshot and the ring window expire; every trim reads the clip, so it can
/// wait for a reader who has not decided yet.
#[derive(Default)]
pub enum Mode {
    /// Collect and finish in one run.
    #[default]
    Full,
    /// Collect only, into this directory, and stop before the first trim.
    Pool(std::path::PathBuf),
    /// Skip collection and finish what `Pool` saved.
    Resume {
        clip: Option<String>,
        image: Option<String>,
        line_text: String,
    },
}

#[derive(Default)]
pub struct Target {
    /// Epoch seconds to resolve "the current line" as of, so reading on while
    /// the capture works cannot pull the audio window onto the next line.
    pub anchor_ts: Option<f64>,
    /// The note to attach to, when the caller created it and knows its id.
    /// Without one the script falls back to the most recently added note, which
    /// is only the right answer while nothing else is added in between.
    pub note_id: Option<i64>,
    pub mode: Mode,
}

/// Run vn-capture.sh once and return its parsed JSON result.
///
/// A failed capture is a normal outcome (a stale line, Anki closed) and comes
/// back as `{"ok": false, ...}` rather than as an error — the reader shows the
/// message and you press again. `Err` is reserved for the script not running at
/// all.
pub async fn run(state: &AppState, target: Target) -> Result<Value, AppError> {
    let script = state.vn_capture_script.clone();
    if !script.is_file() {
        return Err(AppError::BadRequest(format!(
            "vn-capture.sh not found at {} (set KOTODEX_VN_CAPTURE_SH)",
            script.display()
        )));
    }

    // Which window to screenshot. Without it the script grabs whatever has
    // focus, which is the browser `#read` is open in, not the VN.
    let vn_window = vn_window(state).await;

    let mut cmd = tokio::process::Command::new(&script);
    // The script normally reports through notify-send on the desktop it runs
    // on, which is not necessarily where the mine came from; VN_JSON=1 makes it
    // print a result object instead, and the reader shows that.
    cmd.env("VN_JSON", "1");
    // Left unset when empty so a VN_WINDOW inherited from the environment
    // still applies.
    if !vn_window.is_empty() {
        cmd.env("VN_WINDOW", &vn_window);
    }
    // Six decimals: the same shape vn-ws-logger.py writes into lines.log, and
    // finer than any gap between two hooked lines.
    if let Some(ts) = target.anchor_ts {
        cmd.env("VN_ANCHOR_TS", format!("{ts:.6}"));
    }
    if let Some(id) = target.note_id {
        cmd.env("VN_NOTE_ID", id.to_string());
    }
    match &target.mode {
        Mode::Full => {}
        Mode::Pool(outdir) => {
            cmd.env("VN_POOL", "1");
            cmd.env("VN_OUTDIR", outdir);
        }
        Mode::Resume {
            clip,
            image,
            line_text,
        } => {
            // An empty VN_CLIP would read as "collect from the ring", which for
            // a line read hours ago is the wrong answer rather than a fallback.
            // The placeholder keeps the script on the resume branch, where a
            // missing clip is screenshot-only.
            cmd.env("VN_CLIP", clip.as_deref().unwrap_or("-"));
            if let Some(image) = image {
                cmd.env("VN_IMAGE", image);
            }
            cmd.env("VN_LINE_TEXT", line_text);
        }
    }
    let out = match tokio::time::timeout(CAPTURE_TIMEOUT, cmd.output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Err(AppError::Upstream(format!(
                "could not run vn-capture.sh: {e}"
            )));
        }
        Err(_) => {
            return Err(AppError::Upstream(format!(
                "vn-capture.sh timed out after {}s",
                CAPTURE_TIMEOUT.as_secs()
            )));
        }
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let Some(parsed) = stdout.lines().rev().find_map(|l| {
        serde_json::from_str::<Value>(l)
            .ok()
            .filter(Value::is_object)
    }) else {
        // No parseable result: surface the script's own diagnostics, which is
        // all there is to go on (a missing dependency, a broken ring buffer).
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = [stderr.trim(), stdout.trim()]
            .into_iter()
            .find(|s| !s.is_empty())
            .unwrap_or("no output")
            .lines()
            .next_back()
            .unwrap_or("no output")
            .to_string();
        return Err(AppError::Upstream(format!(
            "vn-capture.sh failed: {detail}"
        )));
    };

    if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
        info!(result = %parsed, "vn-capture succeeded");
    } else {
        warn!(result = %parsed, "vn-capture reported failure");
    }
    Ok(parsed)
}

/// Which window is the VN, as everything that needs to know resolves it.
///
/// The current work's own window first, then the global `vn_window` setting,
/// which is a legacy fallback for setups that predate per-work windows. Empty
/// when neither is set.
///
/// One implementation because there are three callers and they must not
/// disagree: this module, the reader's status event, and `vn-capture.sh` over
/// `GET /api/vn/window`. Two places to say which window is the game is the one
/// thing the per-work column exists to stop — the one you forget points at the
/// last VN.
pub async fn vn_window(state: &AppState) -> String {
    let settings = db::load_settings(&state.local).await.unwrap_or_else(|e| {
        warn!(error = %e, "vn window: settings unreadable");
        Default::default()
    });
    vn_window_for(state, &settings).await
}

/// The same answer for a caller that has already loaded the settings.
///
/// The reader's status event has: it is published every two seconds per open
/// surface, so loading them twice for one event is a query per surface per
/// second for nothing.
pub async fn vn_window_for(state: &AppState, settings: &db::Settings) -> String {
    let work = crate::services::reading::current_work(state, settings).await;
    match db::current_work_vn_window(&state.knowledge, &work).await {
        Ok(Some(w)) if !w.trim().is_empty() => w,
        Ok(_) => settings.vn_window.clone(),
        Err(e) => {
            warn!(error = %e, "vn window: the work's own is unreadable");
            settings.vn_window.clone()
        }
    }
}
