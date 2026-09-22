
import { stillNotKnown } from './words.js';

export const SERIES = [
  ['share', 'Unknown %'],
  ['firsts', 'New words'],
];

/** Per-minute difficulty.
 *
 * `share` is the unknown portion of the content words spoken in that minute,
 * not a raw count: speech density varies more than difficulty does, so a raw
 * count ranks a fast easy minute above a slow hard one.
 *
 * `firsts` answers a different question — where new vocabulary lands rather
 * than how hard a minute is — and is the reason both are offered.
 *
 * The denominator comes from the server and never moves. The numerator is
 * summed here from words still not known, which is what makes the curve drop
 * when one is marked known instead of needing a refetch. */
export function difficulty(words, minutes, marks) {
  const spoken = new Map(minutes.map((m) => [m.minute, m.content_tokens]));
  const unknown = new Map();
  const firsts = new Map();

  for (const w of words) {
    if (!stillNotKnown(w, marks)) continue;
    for (const t of w.times) {
      const m = Math.floor(t / 60);
      unknown.set(m, (unknown.get(m) ?? 0) + 1);
    }
    const f = Math.floor(w.first.start_seconds / 60);
    firsts.set(f, (firsts.get(f) ?? 0) + 1);
  }

  return [...spoken.keys()]
    .sort((a, b) => a - b)
    .map((minute) => {
      const total = spoken.get(minute) ?? 0;
      const unk = unknown.get(minute) ?? 0;
      return {
        minute,
        total,
        unknown: unk,
        share: total ? unk / total : 0,
        firsts: firsts.get(minute) ?? 0,
      };
    });
}

export function seriesValue(bucket, series) {
  return series === 'firsts' ? bucket.firsts : bucket.share;
}

export function formatValue(bucket, series) {
  return series === 'firsts'
    ? `${bucket.firsts} new`
    : `${Math.round(bucket.share * 100)}%`;
}
