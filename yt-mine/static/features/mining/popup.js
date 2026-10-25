// yt-mine's half of the dictionary popup.
//
// The popup itself is `web-shared/popup.js`, the same module the VN overlay
// loads — so a word looked up over a game and a word looked up in a transcript
// are the same popup, down to the per-dictionary styling. What is here is what
// is about *this* surface: an ordinary scrolling page, no side mouse buttons,
// and a ＋ that has a video and a timestamp to attach rather than a live
// screen to capture.
//
// It lives outside the Preact tree and is driven imperatively, because the
// shared module owns its own DOM. The row components only tell it which word
// was clicked.

import { createPopup } from '/shared/popup.js';
import { markStatus, mineWord } from './actions.js';

let popup = null;
let ctx = { videoId: null, jobId: null, sentenceId: null, text: '' };

function element() {
  let el = document.getElementById('word-popup');
  if (!el) {
    el = document.createElement('div');
    el.id = 'word-popup';
    el.className = 'jp-popup';
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

function instance() {
  if (popup) return popup;
  popup = createPopup({
    el: element(),
    // yt-mine's own routes. No lookup is recorded — that is a reading-session
    // event and there is no session here — but the mined badge is the same
    // question and the same answer: does Anki already hold this card, and take
    // me to it.
    api: {
      define: (query) => `/api/define?${query}`,
      expand: (text) => `/api/expand?${new URLSearchParams({ text })}`,
      mined: (term) => `/api/mined?term=${encodeURIComponent(term)}`,
      browse: (note_id) =>
        fetch('/api/mined/browse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note_id }),
        }).catch(() => {}),
    },
    scanText: (target) => ctx.text.slice(target.start ?? 0),
    judge: (target, status) => markStatus(target.key, target.reading, status),
    mine: (target) => exportOne(target),
    place,
  });
  // Placed above the word, the box hangs from its top, so anything that grows
  // it after `place` (an image, a chip row, the mined badge) runs down over the
  // word. Re-placing on every resize keeps its bottom on the word.
  new ResizeObserver(() => {
    if (popup.isOpen() && popup.anchor()?.isConnected) place(popup.anchor());
  }).observe(element());
  // Anywhere else dismisses. The popup stops its own clicks inside the shared
  // module, so this never has to ask where the click came from.
  document.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  return popup;
}

/** Open on a word, or close if it is the word already open. */
export function toggle(anchor, target, next) {
  const p = instance();
  if (p.isOpen() && p.anchor() === anchor) return close();
  const previous = p.anchor();
  if (previous) previous.classList.remove('open');
  anchor.classList.add('open');
  ctx = next;
  p.show(anchor, target);
}

export function isOpen() {
  return popup?.isOpen() ?? false;
}

export function close() {
  if (!popup) return;
  const anchor = popup.anchor();
  if (anchor) anchor.classList.remove('open');
  popup.close();
}

/** The wheel over the open word pages its dictionaries — the hand is already
 * there, having just clicked it. Only over that word: anywhere else the wheel
 * still scrolls the page. */
export function wheel(e, anchor) {
  if (!popup || !popup.isOpen() || popup.anchor() !== anchor) return;
  e.preventDefault();
  popup.step(Math.sign(e.deltaY));
}

/** Between the popup and the word, and between the popup and the edge. */
const GAP = 6;
const EDGE = 8;

/** Anchored in *document* coordinates, so the popup stays on its word as the
 * page scrolls rather than hanging in the viewport where the word used to be.
 *
 * Directly above or below the word, on whichever side has more room, and
 * capped at that room so it never covers the word however short the page is.
 * Clamped horizontally so a word at either edge cannot push it off screen. */
function place(anchor) {
  const el = element();
  const rect = anchor.getBoundingClientRect();
  const above = rect.top - GAP - EDGE;
  const below = window.innerHeight - rect.bottom - GAP - EDGE;
  const up = above > below;
  el.style.setProperty('--popup-max', `${Math.max(up ? above : below, 0)}px`);
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = rect.left + rect.width / 2 - width / 2;
  const top = up ? rect.top - height - GAP : rect.bottom + GAP;
  el.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)) + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}

/** ＋ exports this sentence to Anki, now.
 *
 * Not a selection to commit later: a video is read a sentence at a time, and
 * the word being looked at is the word the card is about. `target` is what the
 * popup is open on, so a compound picked out of the scan (経年劣化) is what
 * gets mined rather than the token that was clicked.
 *
 * The popup is left open, as the overlay leaves it: the badge going green on
 * the word just mined is the report, and it is a link to the card. */
function exportOne(target) {
  return mineWord(ctx.jobId, ctx.sentenceId, target.key, target.reading);
}
