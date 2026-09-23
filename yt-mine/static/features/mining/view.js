import { judged } from './state.js';
import { matchesFilter } from './ledger.js';

// A filter is a view, and it is decided once per line rather than re-tested
// every render: marking the last unknown word in a line known would otherwise
// delete that line from under the hand that judged it. A line joins or leaves
// the view when the filter is picked — nothing else moves it.
export function visible(sentences, filter, memo) {
  if (!sentences) return sentences;
  if (memo.current?.filter !== filter) {
    memo.current = { filter, ids: new Set(), decided: new Set() };
  }
  const { ids, decided } = memo.current;
  const marks = judged.peek();
  for (const s of sentences) {
    if (decided.has(s.id)) continue;
    decided.add(s.id);
    if (matchesFilter(s, filter, marks)) ids.add(s.id);
  }
  return sentences.filter((s) => ids.has(s.id));
}
