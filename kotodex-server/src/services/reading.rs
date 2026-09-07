//! Which work is being read right now.
//!
//! The window in front is a fact about what is on screen; `settings.current_work`
//! is a guess someone typed and has to remember to change. So the windows are
//! asked first and the setting is only the fallback: picking another work in the
//! library while a VN is hooked can no longer send its lines to the wrong title.
//!
//! A work is a candidate when its `vn_window` appears in a window title, so the
//! same column that aims the screenshot also names the work — one thing to set,
//! and nothing to keep in sync. Works without one never match, which is what
//! leaves epubs and paper books to the setting.
//!
//! Every reader-facing answer resolves through here: the lines' work, the card's
//! source field, the lookup's work, the capture badge. They are one claim about
//! what is being read and must not disagree.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use tracing::warn;

use crate::app::AppState;
use crate::db;
use crate::services::desktop;

/// How long one answer stands. Asking the window manager costs a process per X
/// display, and this is on the path of every posted line — a batch arriving a
/// second after the last one is the same sitting.
const TTL: Duration = Duration::from_secs(3);

/// The last window-derived answer and when it was taken. Per-app rather than
/// global so the test suite's parallel apps don't share one.
#[derive(Clone, Default)]
pub struct Cache(Arc<Mutex<Option<(Instant, Option<String>)>>>);

/// The work being read, for a caller that has already loaded the settings.
pub async fn current_work(state: &AppState, settings: &db::Settings) -> String {
    from_windows(state)
        .await
        .unwrap_or_else(|| settings.current_work.clone())
}

/// The same answer, loading the settings itself.
pub async fn current_work_now(state: &AppState) -> String {
    let settings = db::load_settings(&state.local).await.unwrap_or_else(|e| {
        warn!(error = %e, "current work: settings unreadable");
        Default::default()
    });
    current_work(state, &settings).await
}

async fn from_windows(state: &AppState) -> Option<String> {
    let mut cache = state.reading.0.lock().await;
    if let Some((taken, work)) = cache.as_ref() {
        if taken.elapsed() < TTL {
            return work.clone();
        }
    }
    let work = probe(state).await;
    *cache = Some((Instant::now(), work.clone()));
    work
}

/// The focused window first: it is the only signal that says which of two open
/// games is being played. Failing that a title that is merely open still names
/// the work, and normally does — reading in the browser beside the VN means the
/// browser is what is focused — but only while one work claims it, since two
/// matches are no answer at all.
async fn probe(state: &AppState) -> Option<String> {
    let works = match db::fetch_works_meta(&state.knowledge).await {
        Ok(works) => works,
        Err(e) => {
            warn!(error = %e, "current work: the library is unreadable");
            return None;
        }
    };
    let hooked: Vec<(String, String)> = works
        .into_iter()
        .filter_map(|w| {
            let window = w.vn_window?;
            let window = window.trim().to_lowercase();
            (!window.is_empty()).then_some((window, w.title))
        })
        .collect();
    if hooked.is_empty() {
        return None;
    }

    if let Ok(Some(front)) = desktop::focused_window().await {
        if let Some(work) = best_match(&hooked, &front) {
            return Some(work);
        }
    }

    let open = desktop::open_windows().await.unwrap_or_default();
    let mut matched: Vec<String> = open
        .iter()
        .filter_map(|title| best_match(&hooked, title))
        .collect();
    matched.sort();
    matched.dedup();
    match matched.len() {
        1 => matched.pop(),
        _ => None,
    }
}

/// The work whose `vn_window` this title contains, longest first — a short
/// pattern that happens to sit inside a longer one must not outrank it.
fn best_match(hooked: &[(String, String)], title: &str) -> Option<String> {
    let title = title.to_lowercase();
    hooked
        .iter()
        .filter(|(window, _)| title.contains(window.as_str()))
        .max_by_key(|(window, _)| window.len())
        .map(|(_, work)| work.clone())
}

#[cfg(test)]
mod tests {
    use super::best_match;

    fn hooked() -> Vec<(String, String)> {
        vec![
            ("sakura".into(), "サクラノ詩".into()),
            ("sakura moyu".into(), "サクラノ刻".into()),
        ]
    }

    #[test]
    fn the_longest_window_pattern_wins() {
        assert_eq!(
            best_match(&hooked(), "Sakura Moyu - Chapter 3").as_deref(),
            Some("サクラノ刻")
        );
    }

    #[test]
    fn a_title_nothing_claims_names_no_work() {
        assert_eq!(best_match(&hooked(), "Firefox"), None);
    }
}
