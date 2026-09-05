// One work's own page: how it was read, sitting by sitting.
//
// Fetched on its own (`/api/works/detail?work=…`) rather than sliced from the
// dashboard poll — it is the whole line stream filtered to one title, which is
// too much to send for every work on the shelf just in case one is opened.
//
// The bars are the work's *own* reading days, not a calendar window. A VN read
// in four sittings over two weeks gets four bars, not fourteen with ten empty:
// what the shape is meant to show is how the reading was distributed, and a
// month of zeroes around it shows nothing.

import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import { DailyBarChart, ProgressBar, SpeedTrendChart } from "../charts.js";
import { api } from "../api.js";
import { fmtChars, fmtDateStr, fmtHours, fmtMins } from "../lib/format.js";
import { WorkMetaForm, setCurrentWork } from "../panels/work-form.js";
import { WorkTriage } from "../panels/work-triage.js";
import { AddPaperBook, PaperLog } from "../panels/paper.js";
import { toggle as openWordPopup, close as closeWordPopup } from "../lib/word-popup.js";
import { Modal } from "../components/modal.js";

const SITTINGS_SHOWN = 20;

/** The synthetic work every logged article aggregates under
 *  (`stats::work::ARTICLES_WORK`). Nothing hooks an article, so it can never
 *  be what the logger stamps lines with. */
const ARTICLES = "Articles";

export function WorkDetail({ work, works, settings, onBack, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [triaging, setTriaging] = useState(false);
  // The `books` row for this work, when the epub has been attached: what the
  // paper position is and the log that moves it. Fetched separately from the
  // detail — `list_books` is one small call and it is the only source of the
  // paper half of the page.
  const [paper, setPaper] = useState(null);

  const isCurrent = settings?.current_work === work;
  // "Read this" points the logger at a title: every line it captures from here
  // on is stamped with it. Meaningless for Articles, which is not a hookable
  // thing but a bucket for text logged after the fact.
  //
  // Stopping is the same control the other way round, and it is the only place
  // that says out loud that reading nothing is a state a reader can be in.
  const canSwitch = work !== ARTICLES;

  async function switchTo(title) {
    setBusy(true);
    try {
      await setCurrentWork(title);
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Named rather than inline so leaving a triage session can re-run it: the
  // session exists to move the figures this fetches.
  const load = () => {
    setDetail(null);
    setError(null);
    api(`/api/works/detail?work=${encodeURIComponent(work)}`)
      .then(setDetail)
      .catch((e) => setError(e.message));
  };
  useEffect(load, [work]);

  const loadPaper = () => {
    api("/api/books")
      .then((r) => setPaper(r.books.find((b) => b.work === work) ?? null))
      .catch(() => {});
  };
  // The previous work's row must not flash under this one: WorkDetail stays
  // mounted across a direct hash change, and detail handles this in `load`.
  useEffect(() => {
    setPaper(null);
    loadPaper();
  }, [work]);

  // The shelf row for this work, which is what `WorkMetaForm` edits by id.
  const row = works.find((w) => w.work === work) ?? null;

  const back = html`
    <button class="ghost" onClick=${onBack}>← library</button>
  `;

  if (error) {
    return html`<div class="card">
      <div class="card-head">
        <h2>${work}</h2>
        ${back}
      </div>
      <p class="chart-empty">${error}</p>
    </div>`;
  }
  if (!detail) {
    return html`<div class="card">
      <div class="card-head">
        <h2>${work}</h2>
        ${back}
      </div>
      <p class="chart-empty">Loading…</p>
    </div>`;
  }

  const meta = detail.meta;
  const done = meta?.status === "finished";
  const speed = detail.speed;
  // A book with an epub knows its own length and where the bookmark is, so it
  // gets the same header line as a VN reading against `total_chars`. The
  // bookmark wins over the logged character count: a paper sitting is logged
  // in pages, and the position is what the reader actually moved.
  const paperTotal = paper?.body_chars || null;
  const paperRead = paperTotal
    ? paperTotal * Math.max(0, Math.min(1, paper.progress ?? 0))
    : null;
  const total = paperTotal ?? meta?.total_chars ?? null;
  const read = paperRead ?? detail.chars;
  const pct = total ? Math.min(100, (read / total) * 100) : null;
  const remainingSecs =
    paperRead !== null
      ? speed > 0
        ? ((total - paperRead) / speed) * 3600
        : null
      : (detail.remaining_secs ?? null);
  // Built whole: htm collapses whitespace where a literal meets an
  // interpolation across a line break.
  const readBetween = [
    fmtDateStr(detail.first_read),
    fmtDateStr(detail.last_read),
  ]
    .filter(Boolean)
    .join(" – ");
  const progressLabel =
    pct !== null
      ? `${fmtChars(Math.round(read))} / ${fmtChars(total)} · ${pct.toFixed(0)}%`
      : null;
  const leftLabel =
    remainingSecs !== null
      ? `${fmtHours(remainingSecs)} left at this work's ${fmtChars(Math.round(speed))}/h`
      : null;

  if (triaging) {
    // Reloads the page's own figures on the way out: a session's whole point
    // is to move them.
    return html`<${WorkTriage}
      work=${work}
      onBack=${() => {
        setTriaging(false);
        load();
      }}
    />`;
  }

  return html`
    <div class="card">
      <div class="card-head">
        <h2>
          ${detail.work}
          ${isCurrent && html`<span class="status-tag">current</span>`}
        </h2>
        <div class="card-controls">
          ${
            canSwitch &&
            html`<button
              class="ghost"
              disabled=${busy}
              onClick=${() => switchTo(isCurrent ? "" : work)}
            >
              ${busy ? "…" : isCurrent ? "stop reading" : "read this"}
            </button>`
          }
          ${
            meta &&
            html`<button class="ghost" onClick=${() => setEditing(true)}>
              edit
            </button>`
          }
          ${back}
        </div>
      </div>

      <div class="work-detail-head">
        ${meta?.cover && html`<img class="cover" src=${meta.cover} alt="" />`}
        <div class="work-detail-facts">
          <dl class="tile-row">
            <div class="tile">
              <dt class="label">characters</dt>
              <dd class="value">${detail.chars.toLocaleString("en")}</dd>
            </div>
            <div class="tile">
              <dt class="label">time</dt>
              <dd class="value">${fmtHours(detail.active_secs)}</dd>
            </div>
            <div class="tile">
              <dt class="label">speed</dt>
              <dd class="value">
                ${speed ? `${fmtChars(Math.round(speed))}/h` : "—"}
              </dd>
            </div>
            <div class="tile">
              <dt class="label">sittings</dt>
              <dd class="value">${detail.sittings.length}</dd>
            </div>
          </dl>
          ${readBetween && html`<div class="meta-hint">read ${readBetween}</div>`}
          ${
            pct !== null &&
            html`<div class="work-detail-progress">
              <${ProgressBar}
                pct=${pct}
                done=${done}
                label=${`Progress through ${detail.work}`}
              />
              <div class="progress-caption">
                <span>${progressLabel}</span>
                <span>${leftLabel ?? ""}</span>
              </div>
            </div>`
          }
        </div>
      </div>

      ${
        editing &&
        row &&
        html`<${Modal}
          title=${`Edit ${detail.work}`}
          onClose=${() => setEditing(false)}
        >
          <${WorkMetaForm}
            work=${row}
            isCurrent=${isCurrent}
            onSaved=${() => {
              setEditing(false);
              onSaved();
            }}
            onCancel=${() => setEditing(false)}
            onDeleted=${() => {
              setEditing(false);
              onSaved();
              onBack();
            }}
          />
        <//>`
      }
    </div>

    <${PaperCard}
      work=${work}
      book=${paper}
      canTrack=${row?.kind === "book"}
      onChanged=${() => {
        load();
        loadPaper();
      }}
    />

    <div class="card">
      <h2>How it was read</h2>
      ${
        detail.days.length
          ? html`<${DailyBarChart}
              days=${detail.days}
              metric="chars"
              targetMins=${0}
            />`
          : html`<p class="chart-empty">No reading days recorded.</p>`
      }
    </div>

    <div class="card">
      <h2>Speed, day by day</h2>
      <${SpeedTrendChart} days=${detail.days} />
    </div>

    <${VocabCard}
      vocab=${detail.vocabulary}
      script=${detail.script}
      onTriage=${() => setTriaging(true)}
    />
    <${UpcomingCard} work=${work} book=${paper} />
    <${SittingsCard} sittings=${detail.sittings} />
  `;
}

/** Where the bookmark is in a book read on paper, and the anchor log that
 *  moves it. A book with no epub yet offers to attach one; a work that is not
 *  a book gets no card at all. */
function PaperCard({ work, book, canTrack, onChanged }) {
  const [adding, setAdding] = useState(false);

  if (!book && !canTrack) return null;

  if (!book) {
    return html`
      <div class="card">
        <div class="card-head">
          <h2>Bookmark</h2>
        </div>
        ${
          adding
            ? html`<${AddPaperBook} work=${work} onDone=${onChanged} />`
            : html`<div class="actions">
                <button class="ghost" onClick=${() => setAdding(true)}>
                  attach an epub
                </button>
              </div>`
        }
      </div>
    `;
  }

  const pct = Math.max(0, Math.min(1, book.progress ?? 0));
  const cpp = book.chars_per_page;
  const read = Math.max(0, book.body_chars * pct);
  const page =
    cpp && book.first_page !== null
      ? `p. ${Math.round(book.first_page + read / cpp)} of ${book.last_page}`
      : `${Math.round(read).toLocaleString("en")} of ${book.body_chars.toLocaleString("en")} chars`;

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Bookmark</h2>
        <div class="card-controls">${(pct * 100).toFixed(1)}%</div>
      </div>
      <div class="progress-caption"><span>${page}</span></div>
      <${PaperLog} book=${book} onLogged=${onChanged} />
    </div>
  `;
}

/** The words the book is about to use that have never been judged known.
 *
 * Read only: the scan does not move the bookmark, record a lookup or count an
 * encounter, so a word previewed here is still met for the first time when the
 * sitting it was read in is logged. Only a press on the popup's ✓ or ✗ writes
 * anything.
 *
 * Closed until asked for, because the scan is a real tokenizer pass over the
 * pages ahead and most visits to a work's page do not want one. `next` carries
 * the scan forward, so "more" continues from where the last batch stopped
 * rather than re-reading the same pages with a bigger limit.
 */
function UpcomingCard({ work, book }) {
  const [terms, setTerms] = useState(null);
  const [next, setNext] = useState(null);
  const [chars, setChars] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The words judged known from this list, by ledger key. Kept rather than
  // dropping the row: the sentence is still worth reading, and a word marked
  // by mistake has to be reachable to be taken back.
  const [judged, setJudged] = useState(() => new Set());

  useEffect(() => {
    setTerms(null);
    setNext(null);
    setChars(0);
    setDone(false);
    setError(null);
    setJudged(new Set());
    closeWordPopup();
  }, [work]);

  if (!book) return null;

  async function load(from) {
    setBusy(true);
    setError(null);
    try {
      const r = await api("/api/books/upcoming", {
        method: "POST",
        body: { work, from },
      });
      setTerms((prev) => [...(from === null ? [] : (prev ?? [])), ...r.terms]);
      setNext(r.next);
      setChars(r.chars);
      setDone(r.done);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const cpp = book.chars_per_page;
  const key = (t) => `${t.headword}\u0000${t.reading}`;
  const left = terms ? terms.filter((t) => !judged.has(key(t))).length : 0;
  // What the list holds and how far ahead it had to read for it. Pages from
  // the character count the scan reports, never from the byte span — a
  // Japanese character is three bytes and the figure would read triple.
  const head = terms
    ? [
        `${left} ${left === 1 ? "word" : "words"}`,
        cpp ? `${Math.max(1, Math.round(chars / cpp))} pages ahead` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  async function markKnown(term) {
    const k = key(term);
    setJudged((prev) => new Set(prev).add(k));
    try {
      await api("/api/vocab/judge", {
        method: "POST",
        body: {
          judgements: [
            { headword: term.headword, reading: term.reading, status: "known" },
          ],
        },
      });
    } catch (e) {
      setJudged((prev) => {
        const out = new Set(prev);
        out.delete(k);
        return out;
      });
      setError(e.message);
    }
  }

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Preview upcoming unknown words</h2>
        <div class="card-controls">${head}</div>
      </div>
      ${
        terms === null
          ? html`<div class="actions">
              <button class="ghost" disabled=${busy} onClick=${() => load(null)}>
                ${busy ? "reading ahead…" : "show upcoming words"}
              </button>
            </div>`
          : html`
              <div class="upcoming">
                ${terms.map(
                  (t, i) => html`<${UpcomingRow}
                    key=${`${t.headword} ${t.reading} ${i}`}
                    term=${t}
                    known=${judged.has(key(t))}
                    onKnown=${() => markKnown(t)}
                  />`,
                )}
              </div>
              ${!terms.length && html`<p class="chart-empty">Nothing unjudged in the pages ahead.</p>`}
              <div class="actions">
                <button
                  class="ghost"
                  disabled=${busy || done}
                  onClick=${() => load(next)}
                >
                  ${done ? "end of the book" : busy ? "reading ahead…" : "more"}
                </button>
              </div>
            `
      }
      ${error && html`<p class="chart-empty">${error}</p>`}
    </div>
  `;
}

/** One word, in the sentence it is first used in.
 *
 * The reading is not written beside the headword: it is the first thing the
 * popup says, and printing it here answers the word before it has been read.
 */
function UpcomingRow({ term, known, onKnown }) {
  const rank = term.freq_rank ?? term.bccwj_rank;
  return html`
    <div class=${known ? "upcoming-row known" : "upcoming-row"}>
      <div class="upcoming-word">
        <span class="upcoming-head">${term.headword}</span>
        ${rank ? html`<span class="upcoming-rank">${rank.toLocaleString("en")}</span>` : null}
        <button class="upcoming-known" disabled=${known} onClick=${onKnown}>
          ${known ? "known" : "mark known"}
        </button>
      </div>
      <${UpcomingSentence} sentence=${term.sentence} start=${term.start} />
    </div>
  `;
}

/** The sentence painted the way the reader paints it — the same statuses off
 *  the same pipeline — with the word this row is about marked as the target.
 *
 *  Token offsets are UTF-16 code units, which is what a JavaScript string is
 *  indexed in, so they slice the text directly. */
function UpcomingSentence({ sentence, start }) {
  const text = sentence.text;
  const tokens = [...(sentence.tokens ?? [])].sort((a, b) => a.start - b.start);
  const parts = [];
  let at = 0;
  for (const t of tokens) {
    if (t.start < at || t.start + t.len > text.length) continue;
    if (t.start > at) parts.push(text.slice(at, t.start));
    const cls = ["w", t.status, t.start === start ? "target" : ""]
      .filter(Boolean)
      .join(" ");
    parts.push(html`
      <span
        class=${cls}
        onClick=${(e) => {
          e.stopPropagation();
          openWordPopup(
            e.currentTarget,
            {
              term: t.headword,
              key: t.headword,
              reading: t.reading ?? "",
              surface: text.slice(t.start, t.start + t.len),
              status: t.status,
              start: t.start,
            },
            text,
          );
        }}
        >${text.slice(t.start, t.start + t.len)}</span
      >
    `);
    at = t.start + t.len;
  }
  if (at < text.length) parts.push(text.slice(at));
  return html`<p class="upcoming-sentence">${parts}</p>`;
}

/** The work's vocabulary, twice over: what has been met in it, and what its
 *  whole script holds.
 *
 *  Met-so-far alone is a sample of the work drawn by how far you happen to
 *  have read, and it flatters it — the words met first are the ones it
 *  repeats. The pair is the figure. By text says how the prose will read; by
 *  word says how much of its vocabulary is still ahead, and the two routinely
 *  disagree.
 *
 *  The script row needs an imported script (`jp-script profile`) and most
 *  works will never have one, so the card degrades to the met row alone. */
function VocabCard({ vocab, script, onTriage }) {
  if (!vocab || !vocab.types) return null;
  const rows = [{ label: "met so far", ...vocab }];
  if (script) rows.push({ label: "whole script", ...script });

  // Progress through the work's vocabulary, which is not progress through its
  // text: the long tail arrives late, so this trails the character count.
  const metPct =
    script && script.types
      ? Math.round((script.met_types / script.types) * 100)
      : null;
  const metLabel =
    metPct === null
      ? null
      : `${script.met_types.toLocaleString("en")} of ${script.types.toLocaleString("en")} words met — ${metPct}%`;

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Vocabulary</h2>
        ${
          script &&
          html`<div class="card-controls">
            <button class="ghost" onClick=${onTriage}>triage the script</button>
          </div>`
        }
      </div>
      <table class="vocab-split">
        <thead>
          <tr>
            <th></th>
            <th>distinct</th>
            <th
              title="Known share of the distinct words"
            >
              known, by word
            </th>
            <th
              title="Known share of the running text"
            >
              known, by text
            </th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <th scope="row">${r.label}</th>
                <td>${r.types.toLocaleString("en")}</td>
                <td>${Math.round(r.known_type_pct)}%</td>
                <td>${Math.round(r.known_token_pct)}%</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${
        metLabel &&
        html`<div class="progress-caption">
          <span>${metLabel}</span>
          <span
            title="The full script includes every route"
          >
            whole script, every route
          </span>
        </div>`
      }
    </div>
  `;
}

/** Every sitting with the work, newest first: how long, how much, how fast.
 *
 *  Pace per sitting is the number worth watching — a VN whose vocabulary
 *  settles reads faster in its second half, and that is visible here and
 *  nowhere else on the dashboard. */
function SittingsCard({ sittings }) {
  const [all, setAll] = useState(false);
  if (!sittings.length) return null;
  const shown = all ? sittings : sittings.slice(0, SITTINGS_SHOWN);
  const more = sittings.length - shown.length;

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Sittings</h2>
        ${
          more > 0 &&
          html`<button class="ghost" onClick=${() => setAll(true)}>
            show all ${sittings.length}
          </button>`
        }
      </div>
      <table class="days">
        <thead>
          <tr>
            <th>date</th>
            <th>started</th>
            <th>time</th>
            <th>chars</th>
            <th>speed</th>
            <th>cards</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((s) => {
            const started = new Date(s.start_ts * 1000).toLocaleTimeString(
              "en-GB",
              { hour: "2-digit", minute: "2-digit" },
            );
            // Below ten minutes the denominator is noise, and an estimated
            // duration came *from* the pace — it can only report it back.
            const speed =
              !s.estimated && s.active_secs >= 600
                ? `${fmtChars(Math.round(s.chars / (s.active_secs / 3600)))}/h`
                : "—";
            const time = s.active_secs > 0 ? fmtMins(s.active_secs) : "—";
            return html`
              <tr>
                <td class="work-name">${s.date}</td>
                <td>${started}</td>
                <td>
                  ${time}${s.estimated && html`<span class="status-tag">est</span>`}
                </td>
                <td>${s.chars.toLocaleString("en")}</td>
                <td>${speed}</td>
                <td>${s.cards || "—"}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}
