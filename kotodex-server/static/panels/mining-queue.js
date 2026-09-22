// `#queue` — the words reading captured, waiting to be judged.
//
// Reached from ⚙ and from the header badge, not from a tab. It is not a view
// over the reading; it is a short list of decisions, and it stops existing when
// they are made.
//
// **One row per word, not per line.** The capture keeps lines, but a card is
// for a word, and a word turns up in several lines of one session — listing
// each sighting asks the same question over and over. Each word is shown in
// the best line it was met in, which is the line carrying fewest other
// unjudged words: a sentence the reader cannot read the rest of teaches none
// of its words well.
//
// Ranking is a button, never automatic. It costs a model call, and a queue
// small enough to read is one nobody needs ranked.

import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api.js";

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);

export function MiningQueueView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () =>
    api("/api/queue")
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const act = async (label, fn) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return html`<div class="card error">${error}</div>`;
  if (!data) return html`<div class="card">Loading…</div>`;

  const entries = data.entries || [];
  const clearLabel = `Clear all — ${data.backlog_items} items, ${mb(data.backlog_bytes)} MB`;

  return html`
    <div class="card">
      <h2>Mining queue</h2>
      ${
        !data.capture_on &&
        html`<p class="muted">
          Capture is off, so nothing is being queued. Turn it on in ⚙ settings.
        </p>`
      }
      ${error && html`<div class="error">${error}</div>`}
      <div class="queue-actions">
        <button
          disabled=${busy !== null || entries.length === 0}
          onClick=${() =>
            act("rank", () => api("/api/queue/rank", { method: "POST" }))}
        >
          ${busy === "rank" ? "Ranking…" : "Rank with the model"}
        </button>
        <button
          disabled=${busy !== null || data.backlog_items === 0}
          onClick=${() =>
            act("clear", () => api("/api/queue/clear", { method: "POST" }))}
        >
          ${clearLabel}
        </button>
      </div>
      ${
        entries.length === 0
          ? html`<p class="muted">Nothing waiting.</p>`
          : entries.map(
              (e) => html`
                <${QueueRow}
                  key=${`${e.headword}/${e.reading}`}
                  entry=${e}
                  busy=${busy !== null}
                  onAct=${act}
                />
              `,
            )
      }
    </div>
  `;
}

function QueueRow({ entry, busy, onAct }) {
  const rankLabel = entry.rank === null ? "—" : `#${entry.rank}`;
  const competing =
    entry.competing > 0 ? `${entry.competing} other new here` : null;

  return html`
    <div class="queue-row">
      <div class="queue-rank" title=${entry.rank_reason || "not ranked"}>
        ${rankLabel}
      </div>
      <div class="queue-body">
        <div class="queue-word">
          <span class="queue-headword">${entry.headword}</span>
          <span class="muted">${entry.reading}</span>
          ${competing && html`<span class="queue-competing">${competing}</span>`}
        </div>
        <p class="queue-text">${entry.text}</p>
        ${
          entry.rank_reason &&
          html`<p class="muted queue-why">${entry.rank_reason}</p>`
        }
      </div>
      <div class="queue-verdict">
        <button
          disabled=${busy}
          onClick=${() =>
            onAct(`promote-${entry.id}`, () =>
              api(`/api/queue/${entry.id}/promote`, {
                method: "POST",
                body: {
                  term: entry.headword,
                  reading: entry.reading,
                  surface: entry.surface,
                },
              }),
            )}
        >
          Mine
        </button>
        <button
          disabled=${busy}
          onClick=${() =>
            onAct(`discard-${entry.id}`, () =>
              api(`/api/queue/${entry.id}/discard`, { method: "POST" }),
            )}
        >
          Discard
        </button>
      </div>
    </div>
  `;
}
