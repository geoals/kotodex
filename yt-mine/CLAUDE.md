# yt-mine — YouTube Sentence Mining

Rust 2024 edition. Axum JSON API + Preact frontend (no build step), SQLite persistence.

## Pipeline

YouTube URL → yt-dlp download → whisper-service transcription → jp-core tokenization → sentence display → click a word → popup → pick the card's word → Anki export

Jobs run as background `tokio::spawn` tasks. Frontend polls via JSON API.

**A whisper segment is cut into its sentences on the way in** (`into_sentences`).
whisper-service primes the model with punctuated Japanese so a mined line keeps
its 。 and 、, and priming also makes it run sentences together — a segment can
hold half a minute of speech and eight sentences, which is not a card. The
punctuation is whisper's own, so
`jp_core::text::sentences::split_sentences` cuts on it. Times are shared out by
character count, which makes a line's audio accurate to a fraction of a second
rather than exact.

This is not the auto-caption mistake in another form. That took line breaks
from a transcript that had none to give; this takes them from punctuation the
model actually emitted.

**A leading `名前 ` is dropped as a hallucinated subtitle speaker label**
(`strip_speaker_label`). Whisper learnt Japanese partly from subtitles written
`名前 セリフ` and writes the label itself on a low-context window; conditioning on
the previous text then carries it forward, so one hallucination becomes hundreds
of lines opening on a name nobody spoke. The ASCII space is what makes this safe
to strip: whisper's Japanese output has none of its own.

Turning `condition_on_previous_text` off is not the fix: it *creates* the label
and strips most of the punctuation, because faster-whisper resets the initial
prompt with it. Conditioning propagates the label; it does not start it.

**The audio is downloaded first, on its own, and the video follows in
parallel.** Transcription is the long step and only needs the audio, so fetching
the merged video ahead of it leaves the GPU idle for the whole download. The
video is video-only (`bv*`) at 480p and is only wanted once a card is mined.

**Whisper transcribes the whole video from 0:00, and that is deliberate.**
YouTube's own auto-captions arrive for the whole video in about a second, but
that ASR drops 。 for stretches at a time, so its line breaks weld five
sentences into one, and a sentence card is only as good as its sentence. Nothing
derived from an auto-caption track can be trusted to say where a line starts and
stops. The transcript is whisper's alone.

**The home page lists what has already been processed** (`/api/videos`, one row
per video rather than per job, since a retried video leaves several). A
transcript is worth coming back to — the words skipped the first time through
are still in it.

A pasted link still carries its timestamp: YouTube's "Copy link at current
time" writes `t=`, `start_seconds_in` reads it, and the page scrolls to that
line as soon as transcription reaches it.

## Key design decisions

- **The tokenizer is `jp_core::highlight`'s, all seven inputs** — the same
  pipeline kotodex-server's reader and ingest use, not a bare Sudachi with the
  headword list. A transcript and a hooked VN line have to segment the same
  way, or a word mined here lands on a ledger key `#read` never produces. It
  also means `analyze` gives each token its ledger status for free
- **Traits for external tools** — `MediaDownloader`, `Transcriber`, `AnkiExporter`, `MediaExtractor`, `Tokenizer` (in jp-core), `LlmDefiner` enable mocking via `mockall`
- **Subprocesses over FFI** — clean boundary for yt-dlp, ffmpeg
- **Remote whisper-service** — transcription offloaded to separate FastAPI container (NDJSON streaming)
- **Preact + htm + signals over an import map** — no build step; `templates/spa.html` maps the bare specifiers onto `web-shared/vendor/`, served at `/shared/`
- **JSON API + SPA shell** — `/api/*` returns JSON, `/`, `/{video_id}` and `/{video_id}/primer` serve the SPA shell

## The popup

A word in a sentence is clicked and the VN overlay's popup opens on it — the
*same module*, `web-shared/popup.js`, served at `/shared/` by both apps and
answering from `/api/define` and `/api/expand`, thin wrappers on
`jp_core::define`. Same head, same frequency pills, same per-dictionary
styling, same wheel-to-page, same escape hatch when the tokenizer was wrong
about a position (経年劣化 split in two, 素振り read the other way).

`static/features/mining/popup.js` is yt-mine's half — only what is about this
surface:

- **Nothing records a lookup.** A lookup is a reading-session event and there
  is no session here, so `define` leaves `lookup_id` null. The mined badge is
  the one thing that does carry over: `/api/mined` runs the same duplicate
  check Yomitan does, and the badge is a link straight to that card.
- **＋ exports the sentence to Anki immediately.** There is no bulk selection
  and no export button. A video is read a sentence at a time and the word being
  looked at is the word the card is about, so there was never a batch to
  assemble. What gets mined is what the popup is *open on*, so a compound
  picked out of the scan is the card's word rather than the token clicked. It
  spins while the mine is out — the export cuts an audio clip and a screenshot
  first, which is seconds — and it is gone once the word is a card: the badge
  and the button are one state, and mining a duplicate is what Anki refuses
  anyway.
- **✓ and ✗ are the only judging.** No side mouse buttons: the sentence list is
  an ordinary page, not a layer over a game.
- **The popup is placed in document coordinates**, appended to `<body>` outside
  the Preact tree, so it stays on its word as the page scrolls instead of
  hanging in the viewport where the word used to be.

Tokens carry their ledger status, and the three tints are kotodex-server's own —
`known` is deliberately not one of them, because the absence of a mark is what
makes the marks readable.

**Rows are rebuilt every render.** Caching a VNode per sentence and handing back
the same reference makes Preact skip the subtree — including when a signal the
row reads has changed — so a word judged in the popup keeps its old tint and the
open token stays outlined after the popup closes.

## Filtering the list

The toolbar above the list picks which lines are drawn: all of them, the ones
holding a word not marked known, or i+1 — exactly one such word. `ledger.js` is
what both the filters and the row's
✓ ask, so "not known" means the same thing in each: `new`, `seen` and
`unknown` alike, since one was never judged and one was refused but both are
words this page exists to do something about.

**A filter is a view, decided once per line.** `visible()` keeps the set of ids
it admitted and only tests lines it has not seen, or marking the last unknown
word in a line known would delete that line from under the hand that judged it
— the same rule as `#read`'s `◌ marked`. The counts in the toolbar *are* live:
they are a label, not the view.

**✓ on the row marks every not-known word in the line known**, through
`/api/judge/many`. Most of a transcript line is already known and the two words
that are not are the reason to stop on it; the button's number is how many
that is.

## The primer

`/{video_id}/primer` is the second view over the same transcript: not what the
video says, but what to learn before watching it. `routes/primer.rs` and
`static/features/primer/`.

**Repetition is the topic-detection rule.** A content word that recurs inside
one video and is not already known is a topic word by construction, because a
programme's domain vocabulary repeats when the programme is about it. No
frequency threshold gates the list — one would cut 政策 and 財政, which are
exactly the words worth priming on.

**Frequency is the sort instead, and both ranks are shown.** The two corpora
disagree hardest on this genre: 財源 is 3,786 in BCCWJ and 47,569 in Jiten.
Sorting by the *lower* of the two is what surfaces the common words that simply
have not been judged — 大臣 534, 増加 609, 市民 715 — and is the same "common in
either is worth seeing" rule `jp_core::highlight` keeps both ranks for.

**The threshold and the ordering are the client's, over one fetch.** Every
not-known word ships once with every occurrence time, so the slider and the
sort cost no request, and neither does the difficulty curve recomputing when a
word is judged.

**`primer_words` stores only what the transcript decides** — the counts, the
first sighting, the offsets, and the two ranks (a fact about the dictionaries,
not the reader). Status is re-read from the ledger on every request in one
`fetch_many`, so a word judged since the build is already gone from the list
and nothing needs rebuilding. The build is redone only when the sentence count
disagrees with `primer_builds`.

**The curve's y is a share, not a count.** Speech density varies more than
difficulty does, so a raw per-minute count ranks a fast easy minute above a slow
hard one. `primer_minutes` holds the denominator — every content word spoken,
known or not — because it does not move when a word is judged and the numerator
does.

Unlike the transcript's frozen `visible()` view, the primer list re-filters
live: it is a reading list being worked down, so a word leaving it the moment it
is marked known is the point.

## Tokenization & Dictionary

Provided by `jp-core` crate. See `jp-core/` for details.

- **Lookup goes through `jp_core::define`**, the same call the VN overlay's
  popup draws from, via `jp_mine_core::lookup::lookup_word` — which flattens it
  to the four things a card holds. So a card gets the dictionaries in reading
  order (明鏡, then the master) rather than install order, and its `Frequency`
  is `READER_FREQUENCY` — how common the word is in fiction, not whichever
  frequency dictionary happened to be installed first. BCCWJ is newspaper prose,
  where 素振り ranks 14,117 against 6,157 in fiction.

## Build & run

```sh
cargo run -p yt-mine                              # server on 0.0.0.0:3000
KOTODEX_FAKE_API=true cargo run -p yt-mine       # dev mode (no external deps)
cargo test -p yt-mine                             # unit + integration (mocked)
cargo test -p yt-mine -- --ignored                # real subprocess tests
```

## Config

Via env vars, loaded from `.env` (repo root) via `dotenvy`. See `config.rs` and
`.env.example`.

`KOTODEX_TRANSLATE_API_KEY` turns on the primer's translate button;
`KOTODEX_TRANSLATE_BASE_URL` and `KOTODEX_TRANSLATE_MODEL` pick the endpoint
(DeepSeek's chat model by default). It is a separate provider from the card
gloss's: a sentence translation is neither worth Opus nor tuned against it. No
key means no button, not a broken primer.

Anki export fields are all configurable via `KOTODEX_ANKI_*` vars (model, deck,
field mapping). Defaults match the "Japanese sentences" Yomitan note type, and
are the same fields kotodex-server writes: the glossary goes to `VocabDefFull`
in Yomitan's per-dictionary markup (`VocabDef` is Yomitan's own short gloss and
not ours to overwrite), the pitch to `VocabPitchNum` + `VocabPitchPattern` as
markup rather than a bare number, and the LLM gloss to `CompactDef`.

**The card is built by `jp_mine_core::card`, the gloss by
`jp_mine_core::compactdef`.** yt-mine has no prompt of its own: a second
paraphrase of the tag rubric drifts from it — a familiarity scale of the wrong
depth, a missing FLAVOR axis — which is what `jp_mine_core::tags` exists to
prevent. `services::llm` is the trait and a thin impl, kept so the fake and the
route tests can stand in for the call.
