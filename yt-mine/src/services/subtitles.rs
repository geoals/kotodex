//! Lines and timings out of a subtitle file, for a local episode.
//!
//! A cue is kept as one line with its own start and end. Subtitle timing is
//! made by hand to the speech, so it is the card's audio as it stands — no
//! sentence splitting and no sharing out of time the way a whisper segment
//! needs.

use crate::models::TranscriptSegment;

#[derive(Debug, thiserror::Error)]
pub enum SubtitleError {
    #[error("unsupported subtitle format: {0}")]
    Unsupported(String),
    #[error("no lines in the subtitle file")]
    Empty,
}

/// Parses `.srt`, `.ass` or `.ssa`, chosen by the file's extension.
pub fn parse(path: &str, content: &str) -> Result<Vec<TranscriptSegment>, SubtitleError> {
    let content = content.trim_start_matches('\u{feff}');
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let cues = match ext.as_str() {
        "srt" => parse_srt(content),
        "ass" | "ssa" => parse_ass(content),
        other => return Err(SubtitleError::Unsupported(other.to_string())),
    };
    let lines = merge_repeats(cues);
    if lines.is_empty() {
        return Err(SubtitleError::Empty);
    }
    Ok(lines)
}

fn parse_srt(content: &str) -> Vec<TranscriptSegment> {
    let content = content.replace("\r\n", "\n");
    let mut out = Vec::new();
    for block in content.split("\n\n") {
        let mut lines = block.lines().skip_while(|l| !l.contains("-->"));
        let Some(timing) = lines.next() else { continue };
        let Some((start, end)) = timing.split_once("-->") else {
            continue;
        };
        let (Some(start), Some(end)) = (srt_time(start), srt_time(end)) else {
            continue;
        };
        let text = lines.map(strip_html_tags).collect::<Vec<_>>().join(" ");
        push_cue(&mut out, start, end, &text);
    }
    out
}

/// `00:01:02,345`, with `.` accepted for the comma.
fn srt_time(s: &str) -> Option<f64> {
    let s = s.split_whitespace().next()?.replace(',', ".");
    clock_time(&s)
}

/// `h:mm:ss.fff`, any number of fraction digits.
fn clock_time(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

fn strip_html_tags(line: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in line.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn parse_ass(content: &str) -> Vec<TranscriptSegment> {
    let mut out = Vec::new();
    let mut in_events = false;
    let mut format: Vec<String> = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(rest) = line.strip_prefix("Format:") {
            format = rest.split(',').map(|f| f.trim().to_ascii_lowercase()).collect();
            continue;
        }
        let Some(rest) = line.strip_prefix("Dialogue:") else {
            continue;
        };
        if format.is_empty() {
            continue;
        }
        // Text is the last field and the only one that may hold commas.
        let fields: Vec<&str> = rest.splitn(format.len(), ',').collect();
        let field = |name: &str| {
            format
                .iter()
                .position(|f| f == name)
                .and_then(|i| fields.get(i))
                .map(|s| s.trim())
        };
        let (Some(start), Some(end), Some(text)) = (
            field("start").and_then(clock_time),
            field("end").and_then(clock_time),
            fields.last(),
        ) else {
            continue;
        };
        // A drawing or a positioned sign is typesetting, not speech.
        if text.contains("\\p1") || text.contains("\\pos(") || text.contains("\\move(") {
            continue;
        }
        push_cue(&mut out, start, end, &strip_ass_tags(text));
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

fn strip_ass_tags(text: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' => in_tag = true,
            '}' if in_tag => in_tag = false,
            _ if in_tag => {}
            '\\' if matches!(chars.peek(), Some('N' | 'n' | 'h')) => {
                chars.next();
                out.push(' ');
            }
            _ => out.push(c),
        }
    }
    out
}

/// A cue's rows join with a space, the separator a Japanese track already uses
/// between phrases.
fn push_cue(out: &mut Vec<TranscriptSegment>, start: f64, end: f64, text: &str) {
    // A song is lyrics over music, not a line anyone says.
    if text.contains('♪') {
        return;
    }
    let text = strip_annotations(text);
    let text = text.trim();
    if text.is_empty() || end <= start {
        return;
    }
    out.push(TranscriptSegment {
        start,
        end,
        text: text.to_string(),
    });
}

/// Drops what a hearing-impaired track adds to the speech: `（安芸）` speaker
/// labels and `（ドアの開閉音）` sound cues in full-width brackets, and furigana
/// in half-width brackets after the word, `倫理(りんり)`. Half-width brackets
/// holding anything but kana are left, since those can be part of the line.
fn strip_annotations(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '（' | '［' => depth += 1,
            '）' | '］' if depth > 0 => depth -= 1,
            _ if depth > 0 => {}
            '(' => {
                let inner: String = chars.clone().take_while(|&c| c != ')').collect();
                let closed = chars.clone().nth(inner.chars().count()) == Some(')');
                if closed && !inner.is_empty() && inner.chars().all(is_kana) {
                    for _ in 0..=inner.chars().count() {
                        chars.next();
                    }
                } else {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
    }
    out
}

fn is_kana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30FF}')
}

/// Where a video's Japanese subtitles are.
#[derive(Debug, Clone)]
pub enum Source {
    File(String),
    Embedded {
        track: usize,
        format: &'static str,
        title: Option<String>,
    },
}

impl Source {
    pub fn describe(&self) -> String {
        match self {
            Source::File(path) => std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone()),
            Source::Embedded { title, .. } => match title {
                Some(t) => format!("track inside the video: {t}"),
                None => "track inside the video".into(),
            },
        }
    }
}

/// A file beside the video with its name comes first, since one put there by
/// hand is the one meant over whatever the release embedded.
pub async fn find(video: &str) -> Option<Source> {
    match sibling(video).await {
        Some(path) => Some(Source::File(path)),
        None => embedded(video).await,
    }
}

pub async fn read(video: &str, source: &Source) -> Result<Vec<TranscriptSegment>, String> {
    match source {
        Source::File(path) => {
            let bytes = tokio::fs::read(path)
                .await
                .map_err(|e| format!("Cannot read {path}: {e}"))?;
            parse(path, &String::from_utf8_lossy(&bytes)).map_err(|e| e.to_string())
        }
        Source::Embedded { track, format, .. } => {
            let out = tokio::process::Command::new("ffmpeg")
                .args(["-v", "error", "-i", video, "-map"])
                .arg(format!("0:s:{track}"))
                .args(["-f", format, "-"])
                .output()
                .await
                .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
            if !out.status.success() {
                return Err("Cannot read the subtitle track".into());
            }
            parse(&format!("embedded.{format}"), &String::from_utf8_lossy(&out.stdout))
                .map_err(|e| e.to_string())
        }
    }
}

/// `ep01.mkv` → `ep01.ja.srt`, `ep01.srt`, `ep01.ass`, …
async fn sibling(video: &str) -> Option<String> {
    let stem = std::path::Path::new(video).with_extension("");
    let stem = stem.to_string_lossy();
    for suffix in [".ja.srt", ".jp.srt", ".srt", ".ja.ass", ".jp.ass", ".ass", ".ssa"] {
        let candidate = format!("{stem}{suffix}");
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return Some(candidate);
        }
    }
    None
}

async fn embedded(video: &str) -> Option<Source> {
    let probe = tokio::process::Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "s", "-show_entries"])
        .args(["stream=codec_name:stream_tags=language,title", "-of", "json", video])
        .output()
        .await
        .ok()?;
    let listing: serde_json::Value = serde_json::from_slice(&probe.stdout).ok()?;
    let streams = listing["streams"].as_array()?;
    streams.iter().enumerate().find_map(|(track, s)| {
        let format = match s["codec_name"].as_str()? {
            "ass" | "ssa" => "ass",
            "subrip" | "mov_text" | "webvtt" | "text" => "srt",
            _ => return None,
        };
        let tags = &s["tags"];
        let lang = tags["language"].as_str()?;
        matches!(lang, "jpn" | "ja" | "jp").then(|| Source::Embedded {
            track,
            format,
            title: tags["title"].as_str().map(str::to_string),
        })
    })
}

/// One line shown across several back-to-back cues is one line. Typesetters
/// split a cue to change its styling partway, and a card per piece would be
/// the same sentence several times.
fn merge_repeats(cues: Vec<TranscriptSegment>) -> Vec<TranscriptSegment> {
    let mut out: Vec<TranscriptSegment> = Vec::with_capacity(cues.len());
    for cue in cues {
        if let Some(last) = out.last_mut()
            && last.text == cue.text
            && cue.start - last.end < 0.1
        {
            last.end = last.end.max(cue.end);
            continue;
        }
        out.push(cue);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_cues_keep_their_own_timing() {
        let srt = "\u{feff}1\r\n00:00:01,500 --> 00:00:03,250\r\nおはよう\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\n<i>今日は</i>\r\nいい天気だね\r\n";
        let lines = parse("ep01.srt", srt).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start, 1.5);
        assert_eq!(lines[0].end, 3.25);
        assert_eq!(lines[0].text, "おはよう");
        assert_eq!(lines[1].text, "今日は いい天気だね");
    }

    #[test]
    fn ass_dialogue_is_read_and_typesetting_dropped() {
        let ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.10,0:00:07.00,Default,,0,0,0,,{\\i1}待って、{\\i0}\\Nどこ行くの？\nDialogue: 0,0:00:06.00,0:00:08.00,Sign,,0,0,0,,{\\pos(320,50)}駅前\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,先に来た\n";
        let lines = parse("ep01.ass", ass).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "先に来た");
        assert_eq!(lines[1].text, "待って、 どこ行くの？");
        assert!((lines[1].start - 5.1).abs() < 1e-9);
    }

    #[test]
    fn a_line_split_across_cues_is_one_line() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nそうだね\n\n2\n00:00:02,000 --> 00:00:03,000\nそうだね\n";
        let lines = parse("a.srt", srt).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].end, 3.0);
    }

    #[test]
    fn hearing_impaired_markup_is_dropped() {
        let srt = "1\n00:00:03,820 --> 00:00:06,320\n（安芸倫也(あきともや)）\nじゃあ ラストスパート\n\n2\n00:00:06,500 --> 00:00:07,000\n（ドアの開閉音）\n\n3\n00:00:07,000 --> 00:00:09,000\n♪～\n\n4\n00:00:09,000 --> 00:00:10,000\n倫理(りんり)の授業 (笑)\n";
        let lines = parse("a.srt", srt).unwrap();
        let texts: Vec<_> = lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(texts, ["じゃあ ラストスパート", "倫理の授業 (笑)"]);
    }

    #[test]
    fn an_unknown_format_is_refused() {
        assert!(parse("a.vtt", "WEBVTT").is_err());
    }
}
