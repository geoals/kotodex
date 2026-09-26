//! The CompactDef gloss for a mined card, behind a trait so the fake and the
//! route tests can stand in for it.
//!
//! The prompt is [`jp_mine_core::compactdef`], shared with kotodex-server, so a
//! transcript card and a VN card are glossed by one rubric.

use std::future::Future;
use std::pin::Pin;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("LLM request failed: {0}")]
    Failed(String),
}

#[cfg_attr(test, mockall::automock)]
pub trait LlmDefiner: Send + Sync {
    /// `word` is the surface as the transcript spelt it, and `sentence` carries
    /// that span in `<b>` tags — the gloss is rated on the spelling the reader
    /// met, never on the headword.
    fn define(
        &self,
        word: &str,
        sentence_context: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, LlmError>> + Send>>;
}

#[derive(Clone)]
pub struct CompactDefiner {
    client: reqwest::Client,
    /// kotodex.db, read-only. Opened lazily, so a missing file is a fallback to
    /// the env key rather than a failed boot.
    settings: sqlx::SqlitePool,
    env_api_key: Option<String>,
}

impl CompactDefiner {
    pub fn new(kotodex_db_path: &str, env_api_key: Option<String>) -> Self {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(kotodex_db_path)
            .read_only(true)
            .busy_timeout(std::time::Duration::from_secs(5));
        Self {
            client: reqwest::Client::new(),
            settings: sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect_lazy_with(options),
            env_api_key,
        }
    }

    /// The same resolution as kotodex-server's `services::llm::provider`, per
    /// call, so a key pasted into the reader's settings applies here without a
    /// restart.
    async fn provider(&self) -> Result<jp_mine_core::llm::Provider, LlmError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT key, value FROM settings \
             WHERE key IN ('llm_provider', 'llm_base_url', 'llm_model', 'llm_api_key')",
        )
        .fetch_all(&self.settings)
        .await
        .unwrap_or_default();
        let get = |k: &str| {
            rows.iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let api_key = get("llm_api_key")
            .or_else(|| self.env_api_key.clone())
            .ok_or_else(|| LlmError::Failed("no LLM API key configured".into()))?;
        Ok(jp_mine_core::llm::Provider {
            kind: get("llm_provider")
                .and_then(|p| jp_mine_core::llm::Kind::parse(&p))
                .unwrap_or(jp_mine_core::llm::Kind::Anthropic),
            base_url: get("llm_base_url").unwrap_or_default(),
            model: get("llm_model").unwrap_or_default(),
            api_key,
        })
    }
}

impl LlmDefiner for CompactDefiner {
    fn define(
        &self,
        word: &str,
        sentence_context: &str,
    ) -> Pin<Box<dyn Future<Output = Result<String, LlmError>> + Send>> {
        let this = self.clone();
        let (word, sentence) = (word.to_string(), sentence_context.to_string());
        Box::pin(async move {
            let provider = this.provider().await?;
            tracing::info!(provider = provider.kind.as_str(), model = %provider.model, "CompactDef request");
            jp_mine_core::compactdef::compact_def(&this.client, &provider, &word, &sentence)
                .await
                .map_err(|e| LlmError::Failed(e.to_string()))
        })
    }
}
