use std::env;
use std::path::PathBuf;

pub use jp_mine_core::config::AnkiConfig;

pub struct Config {
    pub db_path: String,
    /// jp-core's shared knowledge database: the dictionary cache and the
    /// reading record. Separate from this app's own DB.
    pub knowledge_db_path: String,
    pub audio_dir: String,
    pub listen_addr: String,
    pub anki_url: String,
    pub media_dir: String,
    pub anki: AnkiConfig,
    /// Swap every external tool — yt-dlp, whisper, ffmpeg, AnkiConnect — for a
    /// fake, so the server runs with none of them installed.
    pub fake_api: bool,
    /// Absent means cards are exported with no gloss rather than no card.
    pub anthropic_api_key: Option<String>,
    pub whisper_service_url: String,
    pub sudachi_dict_path: PathBuf,
    pub translate: TranslateConfig,
}

/// The model the primer's translate button asks. Separate from the card gloss's
/// provider: a sentence translation is neither worth Opus nor tuned against it.
pub struct TranslateConfig {
    pub base_url: String,
    pub model: String,
    /// Absent means the primer draws no translate button, not that it fails.
    pub api_key: Option<String>,
}

impl TranslateConfig {
    fn from_env() -> Self {
        Self {
            base_url: env::var("KOTODEX_TRANSLATE_BASE_URL")
                .unwrap_or_else(|_| "https://api.deepseek.com".into()),
            model: env::var("KOTODEX_TRANSLATE_MODEL").unwrap_or_else(|_| "deepseek-chat".into()),
            api_key: env::var("KOTODEX_TRANSLATE_API_KEY")
                .ok()
                .filter(|k| !k.trim().is_empty()),
        }
    }
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            knowledge_db_path: env::var("KOTODEX_KNOWLEDGE_DB_PATH").unwrap_or_else(|_| {
                let home = env::var("HOME").expect("HOME not set");
                format!("{home}/.local/share/kotodex/knowledge.db")
            }),
            db_path: env::var("KOTODEX_DB_PATH").unwrap_or_else(|_| {
                let home = env::var("HOME").expect("HOME not set");
                format!("{home}/.local/share/kotodex/yt-mine.db")
            }),
            audio_dir: env::var("KOTODEX_AUDIO_DIR").unwrap_or_else(|_| "audio".into()),
            listen_addr: env::var("KOTODEX_LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into()),
            anki_url: env::var("KOTODEX_ANKI_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8765".into()),
            media_dir: env::var("KOTODEX_MEDIA_DIR").unwrap_or_else(|_| "media".into()),
            fake_api: matches!(env::var("KOTODEX_FAKE_API").as_deref(), Ok("true" | "1"),),
            anthropic_api_key: env::var("KOTODEX_ANTHROPIC_API_KEY").ok(),
            whisper_service_url: env::var("KOTODEX_WHISPER_SERVICE_URL")
                .unwrap_or_else(|_| "http://localhost:8100".into()),
            sudachi_dict_path: env::var("KOTODEX_SUDACHI_DICT_PATH")
                .unwrap_or_else(|_| "system_full.dic".into())
                .into(),
            translate: TranslateConfig::from_env(),
            anki: AnkiConfig {
                tags: vec!["yt-mine".into(), "youtube".into()],
                ..AnkiConfig::from_env()
            },
        }
    }

    pub fn database_url(&self) -> String {
        format!("sqlite://{}?mode=rwc", self.db_path)
    }
}
