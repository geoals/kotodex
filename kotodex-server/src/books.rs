//! Finding a place in a book from ten characters typed off the page.
//!
//! A paper book is logged by saying where the sitting *ended*: the reader
//! types a short string from the last line read, and it is searched forward
//! from where the last session stopped. Everything between the two positions
//! is what was read.
//!
//! **Forward only.** The search never looks behind the stored position, which
//! is what makes a short anchor safe — the same ten characters may well occur
//! earlier in the book, and reading only ever goes one way.
//!
//! Typed text will not match the file byte for byte, so the search runs over a
//! *normalized* copy with a map back to the original offsets: whitespace and
//! line breaks are dropped (the page's line breaks are not the epub's), and
//! fullwidth ASCII is folded. When that finds nothing the search is retried
//! with punctuation dropped as well, since a reader typing from paper will
//! leave out a 「 or a 、 without noticing.

use jp_core::text::chars::is_counted;

/// A book's text prepared for searching: the normalized copy, and the byte
/// offset in the original that each of its bytes came from.
///
/// `starts` is indexed by byte offset into `norm` and has one extra entry, so
/// a match's end can be resolved the same way as its start. Every byte of a
/// normalized character maps to the same original offset, which is what lets a
/// `str::find` result be looked up directly instead of counted to.
pub struct Searchable {
    norm: String,
    starts: Vec<u32>,
}

/// How much text to show either side of a match, so the reader can see it
/// landed in the right place.
const CONTEXT_CHARS: usize = 120;

#[derive(Debug, serde::Serialize)]
pub struct Found {
    /// Byte offset just past the anchor — the new reading position.
    pub end: usize,
    /// Byte offset the anchor starts at. Resuming the search from here + 1 is
    /// what "not this one, keep looking" does.
    pub start: usize,
    pub before: String,
    pub matched: String,
    pub after: String,
    /// Whether punctuation had to be ignored to find it.
    pub loose: bool,
}

impl Searchable {
    /// `loose` additionally drops everything [`is_counted`] rejects, which is
    /// the same punctuation rule the character counts use.
    pub fn build(text: &str, loose: bool) -> Self {
        let mut norm = String::with_capacity(text.len());
        let mut starts = Vec::with_capacity(text.len() + 1);
        for (offset, c) in text.char_indices() {
            let Some(c) = keep(c, loose) else { continue };
            let before = norm.len();
            norm.push(c);
            starts.resize(norm.len(), offset as u32);
            debug_assert!(norm.len() > before);
        }
        starts.push(text.len() as u32);
        Searchable { norm, starts }
    }

    /// The first occurrence at or after `from`, as offsets into the original.
    pub fn find_from(&self, text: &str, from: usize, needle: &str, loose: bool) -> Option<Found> {
        let needle: String = needle.chars().filter_map(|c| keep(c, loose)).collect();
        if needle.is_empty() {
            return None;
        }
        // The first normalized byte whose source character starts at or after
        // `from`. `starts` is non-decreasing, so this is a binary search.
        let begin = self.starts.partition_point(|&s| (s as usize) < from);
        let hit = self.norm.get(begin..)?.find(&needle)? + begin;

        let start = self.starts[hit] as usize;
        let last = self.starts[hit + needle.len() - 1] as usize;
        let end = last + text[last..].chars().next().map_or(0, char::len_utf8);
        Some(Found {
            start,
            end,
            before: tail(&text[..start], CONTEXT_CHARS),
            matched: text[start..end].to_string(),
            after: head(&text[end..], CONTEXT_CHARS),
            loose,
        })
    }
}

/// Search strictly first, then again ignoring punctuation. Two passes rather
/// than one loose one: a strict match is the reader's own spelling and cannot
/// be a coincidence of stripped punctuation.
pub fn find(text: &str, from: usize, anchor: &str) -> Option<Found> {
    Searchable::build(text, false)
        .find_from(text, from, anchor, false)
        .or_else(|| Searchable::build(text, true).find_from(text, from, anchor, true))
}

/// What survives normalization: whitespace never, fullwidth ASCII folded to
/// halfwidth so a phone IME's ７ finds the book's 7.
fn keep(c: char, loose: bool) -> Option<char> {
    if c.is_whitespace() {
        return None;
    }
    let c = match c {
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        _ => c,
    };
    if loose && !is_counted(c) {
        return None;
    }
    Some(c)
}

fn head(s: &str, chars: usize) -> String {
    s.chars().take(chars).collect()
}

fn tail(s: &str, chars: usize) -> String {
    let count = s.chars().count();
    s.chars().skip(count.saturating_sub(chars)).collect()
}

/// Sentences from `from` on, each with the byte offset it starts at.
///
/// [`jp_core::text::sentences`] splits the same way but hands back owned,
/// trimmed strings, and the offsets are the point here: what a sentence is
/// worth showing is decided later, and the position it was found at has to
/// survive that. Newlines end a sentence — an epub's paragraph break is a
/// boundary whether or not the line was punctuated.
pub fn sentences_from(text: &str, from: usize) -> impl Iterator<Item = (usize, &str)> {
    const DELIMITERS: &[char] = &[
        '\u{3002}', '\u{FF01}', '\u{FF1F}', '!', '?', '\u{2026}', '\u{2025}',
    ];
    const TRAILERS: &[char] = &['\u{300D}', '\u{300F}', '\u{FF09}', ')', '"', '\u{201D}'];

    let mut cursor = from;
    std::iter::from_fn(move || {
        while cursor < text.len() {
            let rest = &text[cursor..];
            let mut end = rest.len();
            let mut chars = rest.char_indices().peekable();
            while let Some((i, c)) = chars.next() {
                if c == '\n' || c == '\r' {
                    end = i + c.len_utf8();
                    break;
                }
                if DELIMITERS.contains(&c) {
                    end = i + c.len_utf8();
                    while let Some(&(j, next)) = chars.peek() {
                        if !DELIMITERS.contains(&next) && !TRAILERS.contains(&next) {
                            break;
                        }
                        end = j + next.len_utf8();
                        chars.next();
                    }
                    break;
                }
            }
            let piece = &rest[..end];
            let start = cursor + (piece.len() - piece.trim_start().len());
            cursor += end;
            let trimmed = piece.trim();
            if !trimmed.is_empty() {
                return Some((start, trimmed));
            }
        }
        None
    })
}

/// How far through the body the reading position is, 0..=1.
///
/// Bytes, not characters: the whole point is a progress bar, and counting the
/// characters left would mean loading the text.
pub fn progress(body_start: i64, position: i64, body_end: i64) -> f64 {
    let body = (body_end - body_start).max(1);
    let read = (position - body_start).clamp(0, body);
    read as f64 / body as f64
}

/// Characters per printed page, from the page numbers the body text runs
/// between. `None` until both are known.
pub fn chars_per_page(
    body_chars: i64,
    first_page: Option<i64>,
    last_page: Option<i64>,
) -> Option<f64> {
    let (first, last) = (first_page?, last_page?);
    let pages = last - first + 1;
    (pages > 0 && body_chars > 0).then(|| body_chars as f64 / pages as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "「おはよう」\n少女は言った。\n\n少女は言った。それきり黙った。";

    #[test]
    fn an_anchor_resolves_to_the_end_of_what_was_typed() {
        let f = find(TEXT, 0, "少女は言った").unwrap();
        assert_eq!(&TEXT[..f.end], "「おはよう」\n少女は言った");
        assert!(!f.loose);
    }

    #[test]
    fn the_search_never_looks_behind_the_position() {
        let first = find(TEXT, 0, "少女は言った").unwrap();
        let second = find(TEXT, first.end, "少女は言った").unwrap();
        assert!(second.start > first.start);
    }

    #[test]
    fn line_breaks_in_the_book_do_not_have_to_be_typed() {
        // The page breaks the line where the epub does not, and the reader
        // types straight through it.
        let f = find(TEXT, 0, "「おはよう」少女は").unwrap();
        assert!(f.matched.contains('\n'));
    }

    #[test]
    fn punctuation_left_out_still_finds_the_line() {
        let f = find(TEXT, 0, "おはよう少女は言った").unwrap();
        assert!(f.loose);
        assert_eq!(&TEXT[..f.end], "「おはよう」\n少女は言った");
    }

    #[test]
    fn a_string_that_is_not_there_finds_nothing() {
        assert!(find(TEXT, 0, "存在しない文字列").is_none());
    }

    #[test]
    fn context_comes_back_around_the_match() {
        let f = find(TEXT, 0, "それきり").unwrap();
        assert!(f.before.ends_with("少女は言った。"));
        assert_eq!(f.after, "黙った。");
    }

    #[test]
    fn sentences_come_back_with_the_offsets_they_were_found_at() {
        let got: Vec<_> = sentences_from(TEXT, 0).collect();
        for (at, sentence) in &got {
            assert_eq!(&TEXT[*at..*at + sentence.len()], *sentence);
        }
        assert!(got.iter().any(|(_, s)| s.ends_with('\u{300D}')));
    }

    #[test]
    fn a_sentence_iterator_starts_where_it_is_told() {
        let from = TEXT.find("それきり").unwrap();
        let (at, first) = sentences_from(TEXT, from).next().unwrap();
        assert_eq!(at, from);
        assert!(first.starts_with("それきり"));
    }

    #[test]
    fn pages_come_from_the_span_the_body_runs_between() {
        assert_eq!(chars_per_page(6000, Some(5), Some(14)), Some(600.0));
        assert_eq!(chars_per_page(6000, Some(5), None), None);
    }
}
