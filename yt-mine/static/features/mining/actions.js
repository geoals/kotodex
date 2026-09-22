
import { exportSentences, judgeWord } from '../../api.js';
import { exportedIds, exportResult, judged } from './state.js';

/** Assert a status, then repaint. The signal is only written after the server
 * accepts it, so nothing has to be rolled back. */
export async function markStatus(key, reading, status) {
  if (!(await judgeWord(key, reading, status))) return false;
  judged.value = new Map(judged.value).set(`${key} ${reading}`, status);
  return true;
}

/** Export one sentence to Anki, keyed on the word the card is about.
 *
 * Returns the new card's note id, which is what the mined badge links to. The
 * export answers with a count rather than an id, so the card is found the same
 * way the badge finds any other — by asking Anki for it. */
export async function mineWord(jobId, sentenceId, key, reading) {
  try {
    const result = await exportSentences(jobId, [
      { id: sentenceId, target_word: key, target_reading: reading },
    ]);
    exportedIds.value = new Set([...exportedIds.value, ...result.exported_ids]);
    exportResult.value = `${key} exported to Anki.`;
  } catch (err) {
    exportResult.value = `Error: ${err.message}`;
    return null;
  }

  try {
    const res = await fetch(`/api/mined?term=${encodeURIComponent(key)}`);
    return (await res.json()).note_id;
  } catch {
    return null;
  }
}
