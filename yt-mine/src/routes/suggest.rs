//! Words the learner probably already knows, picked by a model for a yes/no.
//!
//! Only `new` words are sent: `unknown` is a "no" the learner already gave.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, State};
use jp_core::knowledge::lexeme;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::app::AppState;
use crate::error::AppError;
use crate::routes::primer;

const MAX_WORDS: usize = 400;

const MAX_TOKENS: u32 = 8000;

const WHYS: [&str; 4] = ["loanword", "common", "compound", "name"];

fn system_prompt(known_words: i64) -> String {
    format!(
        "You help a Japanese learner clean up their vocabulary list. A word counts as \
known only after the learner marks it, so many words they know are still unmarked.

The learner: advanced. Knows about {known_words} words by their own marking, and more \
they have not marked. Reads visual novels in Japanese and follows native YouTube talk \
and interview videos without subtitles.

You get the unmarked words from one video. Each line is: number, word, reading, times \
said, and one line where it is said.

Pick the words this learner almost certainly knows. Give each one reason:
- loanword: a katakana loanword whose source word is obvious
- common: an everyday word well within their level
- compound: a compound whose parts they know and whose meaning follows from them
- name: a person, place, company, brand or title

Leave out anything they might not know, and anything specialist or rare. When unsure, \
leave it out: a word marked known stops being shown to them.

Reply with JSON only, no prose: {{\"known\":[{{\"i\":<number>,\"why\":\"<reason>\"}}]}}"
    )
}

#[derive(Deserialize)]
struct Reply {
    known: Vec<Pick>,
}

#[derive(Deserialize)]
struct Pick {
    i: usize,
    why: String,
}

pub async fn suggest_known(
    State(state): State<AppState>,
    Path(video_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let provider = state
        .translator
        .clone()
        .ok_or_else(|| AppError::BadRequest("no model is configured".into()))?;

    let Json(primer) = primer::get_primer(State(state.clone()), Path(video_id)).await?;
    let mut words: Vec<&Value> = primer["words"]
        .as_array()
        .map(|w| w.iter().filter(|w| w["status"] == "new").collect())
        .unwrap_or_default();
    words.sort_by_key(|w| std::cmp::Reverse(w["count"].as_i64().unwrap_or(0)));
    words.truncate(MAX_WORDS);
    if words.is_empty() {
        return Ok(Json(json!({ "asked": 0, "candidates": [] })));
    }

    let known_words = lexeme::known_lexemes(&state.knowledge).await?;
    let system = system_prompt(known_words);
    let list = words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            format!(
                "{i}\t{}\t{}\t×{}\t{}",
                w["headword"].as_str().unwrap_or_default(),
                w["reading"].as_str().unwrap_or_default(),
                w["count"],
                w["first"]["text"].as_str().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let messages = [json!({ "role": "user", "content": list })];
    let ask = jp_mine_core::llm::Ask {
        system: &system,
        messages: &messages,
        max_tokens: MAX_TOKENS,
        default_model: &provider.model,
        cache_system: false,
    };
    let answer = match provider.complete(&state.http, &ask).await {
        Ok(a) => a,
        Err(jp_mine_core::llm::Error::Unavailable(e)) => return Err(AppError::BadRequest(e)),
        Err(e) => return Err(AppError::Upstream(e.to_string())),
    };
    let reply = parse_reply(&answer).ok_or_else(|| {
        AppError::Upstream(format!(
            "the model's reply was not the JSON asked for: {answer}"
        ))
    })?;

    let mut picked: HashMap<usize, String> = HashMap::new();
    for p in reply.known {
        if p.i < words.len() && WHYS.contains(&p.why.as_str()) {
            picked.entry(p.i).or_insert(p.why);
        }
    }
    let mut picked: Vec<_> = picked.into_iter().collect();
    picked.sort_by_key(|(i, _)| *i);

    let candidates: Vec<Value> = picked
        .into_iter()
        .map(|(i, why)| {
            let w = words[i];
            json!({
                "headword": w["headword"],
                "reading": w["reading"],
                "count": w["count"],
                "why": why,
                "first": w["first"],
            })
        })
        .collect();

    Ok(Json(
        json!({ "asked": words.len(), "candidates": candidates }),
    ))
}

fn parse_reply(answer: &str) -> Option<Reply> {
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    serde_json::from_str(answer.get(start..=end)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_fenced_reply() {
        let r = parse_reply("```json\n{\"known\":[{\"i\":3,\"why\":\"loanword\"}]}\n```").unwrap();
        assert_eq!(r.known.len(), 1);
        assert_eq!(r.known[0].i, 3);
    }

    #[test]
    fn rejects_prose() {
        assert!(parse_reply("I cannot help with that.").is_none());
    }
}
