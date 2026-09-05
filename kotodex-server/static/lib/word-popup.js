// The dashboard's half of the dictionary popup.
//
// The popup itself is `web-shared/popup.js`, the same module the VN overlay
// and yt-mine load. What is here is what is about *this* surface: an ordinary
// scrolling page with nowhere to send a card and no session to record a lookup
// against, so it draws a definition and the two judge buttons and nothing
// else.
//
// It lives outside the Preact tree and is driven imperatively, because the
// shared module owns its own DOM.

import { createPopup } from "/shared/popup.js";
import { api } from "../api.js";

let popup = null;
// The text the expansion scan reads, set by whoever opened the popup.
let scan = "";

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
      define: (query) => `/api/reader/define?${query}`,
      expand: (text) => `/api/reader/expand?${new URLSearchParams({ text })}`,
    },
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
    place,
  });
  document.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  return popup;
}

/** Open on a word, or close if it is the word already open. */
export function toggle(anchor, target, text) {
  const p = instance();
  if (p.isOpen() && p.anchor() === anchor) return close();
  const previous = p.anchor();
  if (previous) previous.classList.remove("open");
  anchor.classList.add("open");
  scan = text ?? "";
  p.show(anchor, target);
}

export function close() {
  if (!popup) return;
  const anchor = popup.anchor();
  if (anchor) anchor.classList.remove("open");
  popup.close();
}

/** Anchored in document coordinates so the popup stays on its word as the page
 *  scrolls, below it where there is room and above it otherwise. */
function place(anchor) {
  const el = element();
  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = rect.left + rect.width / 2 - width / 2;
  const room = window.innerHeight - rect.bottom;
  const top = room > height || rect.top < height ? rect.bottom + 6 : rect.top - height - 6;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8)) + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}
