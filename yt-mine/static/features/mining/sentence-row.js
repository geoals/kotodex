import { html } from 'htm/preact';
import { exportedIds, audioState, judged } from './state.js';
import { toggle, wheel } from './popup.js';
import { markStatus, mineWord } from './actions.js';
import { judgeWords } from '../../api.js';
import { key, notKnown, statusOf } from './ledger.js';

let lastSide = -Infinity;

export function SentenceRow({ sentence, videoId, jobId, active, onSeek }) {
  const exported = exportedIds.value;
  const audio = audioState.value;
  const marks = judged.value;

  const isExported = exported.has(sentence.id);
  const isPlaying = audio.sentenceId === sentence.id && audio.playing;
  const isLoading = audio.sentenceId === sentence.id && audio.loading;

  function open(tok, event) {
    if (isExported) return;
    // The click must not reach the document handler that dismisses.
    event.stopPropagation();
    toggle(
      event.currentTarget,
      {
        term: tok.base_form,
        // The ledger key and the dictionary's spelling are the same thing for
        // a token — they diverge only for a match picked out of the scan.
        key: tok.base_form,
        reading: tok.reading,
        surface: tok.surface,
        status: statusOf(tok, marks),
        start: tok.start,
      },
      { videoId, jobId, sentenceId: sentence.id, text: sentence.text },
    );
  }

  // The side buttons act on the word under the pointer without a popup, as the
  // overlay's do. Back is 3 and forward 4. Browsers differ in which of
  // `pointerup`, `mouseup` and `auxclick` they send for these buttons, so all
  // three are heard and the first one of a press acts. Both buttons navigate
  // the frame, so the default has to go on the down events too.
  const SIDE_ACTIONS = {
    3: (tok) => markStatus(tok.base_form, tok.reading, statusOf(tok, marks) === 'known' ? 'unknown' : 'known'),
    4: (tok) => mineWord(jobId, sentence.id, tok.base_form, tok.reading),
  };
  function sideDown(e) {
    if (SIDE_ACTIONS[e.button]) e.preventDefault();
  }
  function sideClick(tok, e) {
    const action = SIDE_ACTIONS[e.button];
    if (!action || isExported) return;
    e.preventDefault();
    if (e.timeStamp - lastSide < 300) return;
    lastSide = e.timeStamp;
    action(tok);
  }

  // Most of a line is already known, and the two words that are not are the
  // reason to stop on it. This says "nothing here" in one hit instead of a
  // popup per word — the same write ✓ makes, against the same rows.
  const pending = notKnown(sentence, marks);
  async function markLineKnown() {
    const words = pending.map((t) => ({ headword: t.base_form, reading: t.reading }));
    if (!words.length || !(await judgeWords(words, 'known'))) return;
    const next = new Map(judged.value);
    for (const tok of pending) next.set(key(tok), 'known');
    judged.value = next;
  }

  function handlePlay() {
    window.dispatchEvent(new CustomEvent('play-sentence', {
      detail: { videoId, sentenceId: sentence.id, start: sentence.start_time, end: sentence.end_time },
    }));
  }

  return html`
    <li
      class=${[isExported && 'exported', active && 'now'].filter(Boolean).join(' ')}
      data-id=${sentence.id}
      data-start=${sentence.start_seconds}
    >
      <button
        class="play-btn ${isLoading ? 'loading' : ''}"
        onClick=${handlePlay}
        disabled=${isLoading}
        title="Play audio"
      >
        ${isPlaying ? '■' : isLoading ? '○' : '▶'}
      </button>
      ${onSeek
        ? html`<button class="timestamp seek" onClick=${() => onSeek(sentence)} title="Jump here">${sentence.timestamp}</button>`
        : html`<span class="timestamp">${sentence.timestamp}</span>`}
      <span class="sentence-tokens">
        ${sentence.tokens.map((tok) => {
          if (!tok.is_content_word) {
            return html`<span class="token">${tok.surface}</span>`;
          }
          // The tint is the ledger's, repainted from `judged` for anything
          // marked since the page loaded. `known` gets no tint at all — the
          // absence of a mark is what makes the marks readable, same as
          // kotodex-server's feed.
          const status = statusOf(tok, marks);
          const cls = ['token content-word', status && status !== 'known' ? `mark-${status}` : '']
            .filter(Boolean)
            .join(' ');
          return html`
            <span
              class=${cls}
              onClick=${(e) => open(tok, e)}
              onMouseDown=${sideDown}
              onPointerDown=${sideDown}
              onMouseUp=${(e) => sideClick(tok, e)}
              onPointerUp=${(e) => sideClick(tok, e)}
              onAuxClick=${(e) => sideClick(tok, e)}
              onWheel=${(e) => wheel(e, e.currentTarget)}
            >${tok.surface}</span>
          `;
        })}
      </span>
      ${pending.length > 0 && html`
        <button class="know-btn" onClick=${markLineKnown} title="Mark every word in this line known">
          <span>✓</span><span class="count">${pending.length}</span>
        </button>
      `}
    </li>
  `;
}
