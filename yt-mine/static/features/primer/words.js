// Which of a video's words the primer is showing, and in what order.
//
// Both controls are client-side over one fetch: the server ships every
// not-known word once, so the threshold and the ordering cost no request.

import { judged } from '../mining/state.js';

export function wordKey(word) {
  return `${word.headword} ${word.reading}`;
}

export function statusOfWord(word, marks = judged.value) {
  return marks.get(wordKey(word)) ?? word.status;
}

export function stillNotKnown(word, marks) {
  const status = statusOfWord(word, marks);
  return status !== 'known' && status !== 'blacklisted';
}

// A rank the list can sort on. A word absent from a list is not rank-zero.
const UNRANKED = Number.MAX_SAFE_INTEGER;

// The commoner of the two corpora. They disagree hardest on exactly the genre
// this view is for — 財源 is 3,786 in BCCWJ and 47,569 in Jiten — and a word
// common in either is one worth seeing first.
export function bestRank(word) {
  return Math.min(word.freq_rank ?? UNRANKED, word.bccwj_rank ?? UNRANKED);
}

export const SORTS = [
  ['time', 'Order'],
  ['count', 'Repeats'],
  ['rank', 'Common'],
];

const COMPARE = {
  time: (a, b) => a.first.start_seconds - b.first.start_seconds,
  count: (a, b) => b.count - a.count || a.first.start_seconds - b.first.start_seconds,
  rank: (a, b) => bestRank(a) - bestRank(b) || b.count - a.count,
};

/** The rows to draw: still not known, repeated at least `threshold` times.
 *
 * Unlike the transcript's frozen view, this re-filters live. A primer is a
 * reading list being worked down, so a word leaving it the moment it is marked
 * known is the point rather than the hazard. */
export function visibleWords(words, threshold, sort, marks) {
  return words
    .filter((w) => w.count >= threshold && stillNotKnown(w, marks))
    .sort(COMPARE[sort] ?? COMPARE.time);
}

/** How many words each threshold would leave, for the slider's readout. */
export function countsByThreshold(words, max, marks) {
  const counts = new Array(max + 1).fill(0);
  for (const w of words) {
    if (!stillNotKnown(w, marks)) continue;
    for (let n = 1; n <= Math.min(w.count, max); n++) counts[n]++;
  }
  return counts;
}
