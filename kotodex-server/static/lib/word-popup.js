// The dashboard's half of the dictionary popup.
//
// The popup itself is `web-shared/popup.js`, the same module the VN overlay
// and yt-mine load. What is here is what is about *this* surface: an ordinary
// scrolling page with no session to record a lookup against, so it draws a
// definition, the two judge buttons and ＋. The card is built by
// `/api/reader/mine`, the same route the overlay uses, so a word mined from a
// book's word list is the same card as one mined while reading.
//
// It lives outside the Preact tree and is driven imperatively, because the
// shared module owns its own DOM.

import { createPopup } from "/shared/popup.js";
import { api } from "../api.js";

let popup = null;
// The text the expansion scan reads, set by whoever opened the popup.
let scan = "";
// The sentence a mine puts on the card, and the work it names as the source —
// both set by whoever opened the popup.
let sentence = "";
let work = "";
// Answers already fetched, by URL. A list that knows which words it will be
// asked about warms this, so the popup draws with no wait at all.
const preloaded = new Map();

function request(url) {
  let pending = preloaded.get(url);
  if (!pending) {
    pending = fetch(url);
    preloaded.set(url, pending);
  }
  return pending.then((r) => r.clone());
}

/** Fetch the definition and the expansion for a word before it is asked for. */
export function preload(target, text) {
  const query = new URLSearchParams({ term: target.term });
  if (target.reading) query.set("reading", target.reading);
  request(defineUrl(query.toString()));
  request(expandUrl((text ?? "").slice(target.start ?? 0)));
}

const defineUrl = (query) => `/api/reader/define?${query}`;
const expandUrl = (text) => `/api/reader/expand?${new URLSearchParams({ text })}`;

function element() {
  let el = document.getElementById("word-popup");
  if (!el) {
    el = document.createElement("div");
    el.id = "word-popup";
    el.className = "jp-popup";
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

function instance() {
  if (popup) return popup;
  popup = createPopup({
    el: element(),
    api: {
      define: defineUrl,
      expand: expandUrl,
      mined: (term) => `/api/reader/mined?term=${encodeURIComponent(term)}`,
    },
    fetch: request,
    scanText: (target) => scan.slice(target.start ?? 0),
    // The only write on this surface, and it takes a deliberate press: looking
    // at a word here is not meeting it, so nothing else the popup does touches
    // the ledger.
    judge: async (target, status) => {
      try {
        await api("/api/vocab/judge", {
          method: "POST",
          body: {
            judgements: [
              { headword: target.key, reading: target.reading, status },
            ],
          },
        });
        return true;
      } catch {
        return false;
      }
    },
    mine: async (target) => {
      const res = await api("/api/reader/mine", {
        method: "POST",
        body: {
          term: target.key,
          reading: target.reading ?? "",
          surface: target.surface ?? target.key,
          sentence,
          work,
        },
      });
      return res?.note_id ?? null;
    },
    place,
  });
  document.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  return popup;
}

/** Open on a word, or close if it is the word already open. */
export function toggle(anchor, target, text, source = "") {
  const p = instance();
  if (p.isOpen() && p.anchor() === anchor) return close();
  const previous = p.anchor();
  if (previous) previous.classList.remove("open");
  anchor.classList.add("open");
  scan = text ?? "";
  sentence = text ?? "";
  work = source;
  p.show(anchor, target);
}

export function close() {
  if (!popup) return;
  const anchor = popup.anchor();
  if (anchor) anchor.classList.remove("open");
  popup.close();
}

/** Anchored in document coordinates so the popup stays on its word as the page
 *  scrolls, always below it — the page scrolls, so a popup that runs past the
 *  bottom is reached by scrolling rather than by covering the word. */
function place(anchor) {
  const el = element();
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const left = rect.left + rect.width / 2 - width / 2;
  const top = rect.bottom + 6;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8)) + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}
