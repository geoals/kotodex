//! Where one sentence ends and the next begins.
//!
//! Two questions over one rule: [`split_sentences`] cuts a passage into all of
//! them, [`sentence_at`] returns the single one covering a position. A card
//! wants the second — a hooked line can hold two sentences and only one of
//! them holds the mined word.

const DELIMITERS: &[char] = &['。', '！', '？', '!', '?', '…', '‥'];
const TRAILERS: &[char] = &['」', '』', '）', ')', '"', '\u{201D}'];

/// Split Japanese text into sentences on 。！？…‥ (and ASCII !?), keeping the
/// delimiter. Closing quotes/brackets directly after a delimiter stay attached
/// to the preceding sentence. Newlines also act as boundaries (manga bubbles
/// often lack final punctuation).
pub fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\n' || c == '\r' {
            push_sentence(&mut sentences, &mut current);
            continue;
        }
        current.push(c);
        if DELIMITERS.contains(&c) {
            while let Some(&next) = chars.peek() {
                if DELIMITERS.contains(&next) || TRAILERS.contains(&next) {
                    current.push(next);
                    chars.next();
                } else {
                    break;
                }
            }
            push_sentence(&mut sentences, &mut current);
        }
    }
    push_sentence(&mut sentences, &mut current);

    sentences
}

/// The one sentence covering `offset`, a byte index into `text`.
///
/// The same boundaries [`split_sentences`] cuts on, asked the other way round:
/// the caller knows where the word is, not which sentence number it fell in.
/// An offset past the end answers with the last sentence, and text with no
/// delimiter at all is one sentence.
pub fn sentence_at(text: &str, offset: usize) -> &str {
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '\n' || c == '\r' {
            if offset < i {
                return text[start..i].trim();
            }
            start = i + c.len_utf8();
            continue;
        }
        if !DELIMITERS.contains(&c) {
            continue;
        }
        // The delimiter and anything closing after it belong to the sentence
        // that ended, so the boundary is past the whole run.
        let mut stop = i + c.len_utf8();
        while let Some(&(j, next)) = chars.peek() {
            if DELIMITERS.contains(&next) || TRAILERS.contains(&next) {
                stop = j + next.len_utf8();
                chars.next();
            } else {
                break;
            }
        }
        if offset < stop {
            return text[start..stop].trim();
        }
        start = stop;
    }
    text[start..].trim()
}

fn push_sentence(sentences: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        sentences.push(trimmed.to_string());
    }
    current.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_periods() {
        assert_eq!(
            split_sentences("今日は暑い。明日は寒い。"),
            vec!["今日は暑い。", "明日は寒い。"],
        );
    }

    #[test]
    fn keeps_text_without_delimiter_as_one_sentence() {
        assert_eq!(
            split_sentences("よろしくお願いします"),
            vec!["よろしくお願いします"]
        );
    }

    #[test]
    fn splits_on_question_and_exclamation() {
        assert_eq!(
            split_sentences("本当？すごい！やった"),
            vec!["本当？", "すごい！", "やった"],
        );
    }

    #[test]
    fn takes_only_the_sentence_the_offset_falls_in() {
        let line = "俺の世界は、決定的に変容した。何もかもがどうでもよかったあの灰色の、無感動な世界に、既に俺はいない";
        let at = line.find("無感動").unwrap();
        assert_eq!(
            sentence_at(line, at),
            "何もかもがどうでもよかったあの灰色の、無感動な世界に、既に俺はいない"
        );
        let first = line.find("決定的").unwrap();
        assert_eq!(sentence_at(line, first), "俺の世界は、決定的に変容した。");
    }

    #[test]
    fn the_delimiter_belongs_to_the_sentence_it_ends() {
        let line = "本当？すごい！";
        assert_eq!(sentence_at(line, line.find("本当").unwrap()), "本当？");
        assert_eq!(sentence_at(line, line.find("すごい").unwrap()), "すごい！");
    }

    #[test]
    fn a_closing_bracket_stays_with_its_sentence() {
        let line = "「やめろ！」と言った。";
        assert_eq!(sentence_at(line, 0), "「やめろ！」");
    }

    #[test]
    fn text_without_a_delimiter_is_one_sentence() {
        assert_eq!(sentence_at("よろしくお願いします", 3), "よろしくお願いします");
    }

    #[test]
    fn an_offset_past_the_end_answers_with_the_last_sentence() {
        let line = "今日は暑い。明日は寒い";
        assert_eq!(sentence_at(line, line.len() + 99), "明日は寒い");
    }

    #[test]
    fn groups_delimiter_runs() {
        assert_eq!(
            split_sentences("なに！？そんな……まさか"),
            vec!["なに！？", "そんな……", "まさか"],
        );
    }

    #[test]
    fn keeps_closing_quote_with_sentence() {
        assert_eq!(
            split_sentences("「行くぞ！」と言った。"),
            vec!["「行くぞ！」", "と言った。"],
        );
    }

    #[test]
    fn splits_on_newlines() {
        assert_eq!(split_sentences("一行目\n二行目"), vec!["一行目", "二行目"],);
    }

    #[test]
    fn empty_input_yields_no_sentences() {
        assert_eq!(split_sentences(""), Vec::<String>::new());
        assert_eq!(split_sentences("  \n "), Vec::<String>::new());
    }
}
