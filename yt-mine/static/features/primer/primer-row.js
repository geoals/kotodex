import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { translateText } from '../../api.js';
import { audioState, judged } from '../mining/state.js';
import { markStatus, mineWord } from '../mining/actions.js';
import { toggle, wheel } from '../mining/popup.js';
import { statusOfWord } from './words.js';

function rankPill(label, rank) {
  return rank == null ? null : `${label} ${rank.toLocaleString()}`;
}

export function PrimerRow({ word, videoId, jobId }) {
  const marks = judged.value;
  const [translation, setTranslation] = useState(null);
  const [translating, setTranslating] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [mining, setMining] = useState(false);
  const [noteId, setNoteId] = useState(null);

  const audio = audioState.value;
  const sentenceId = word.first.sentence_id;
  const isPlaying = audio.playing && audio.sentenceId === sentenceId;
  const isLoading = audio.loading && audio.sentenceId === sentenceId;

  const status = statusOfWord(word, marks);
  const repeats = `×${word.count}`;
  const jiten = rankPill('jiten', word.freq_rank);
  const bccwj = rankPill('bccwj', word.bccwj_rank);
  const met = word.encounter_count > 0 ? `met ${word.encounter_count}×` : 'first met here';

  // JavaScript string indices are UTF-16 units, which is what the server counted
  // the offset in, so this slices where the tokenizer said the word was.
  const { text, start, len } = word.first;
  const before = text.slice(0, start);
  const surface = text.slice(start, start + len);
  const after = text.slice(start + len);

  function play() {
    window.dispatchEvent(
      new CustomEvent('play-sentence', { detail: { videoId, sentenceId } }),
    );
  }

  function openPopup(event) {
    // Without this the document-level dismisser closes the popup on the same
    // click that opened it.
    event.stopPropagation();
    toggle(
      event.currentTarget,
      {
        term: word.headword,
        key: word.headword,
        reading: word.reading,
        surface,
        status,
        start,
      },
      { videoId, jobId, sentenceId, text },
    );
  }

  // Judging is the whole point of the list, so it is on the row rather than
  // behind the popup. The popup still offers both; this is the same call.
  function judge(status) {
    return markStatus(word.headword, word.reading, status);
  }

  // A word already on a card never reaches this list — the server drops it —
  // so the badge only appears for one mined from this row, just now.
  const mined = noteId != null;

  function browseMined() {
    fetch('/api/mined/browse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note_id: noteId }),
    }).catch(() => {});
  }

  async function mine() {
    setMining(true);
    try {
      setNoteId(await mineWord(jobId, sentenceId, word.headword, word.reading));
    } finally {
      setMining(false);
    }
  }

  async function translate() {
    setTranslating(true);
    try {
      setTranslation(await translateText(text));
    } catch (e) {
      setTranslation(e.message);
    } finally {
      setTranslating(false);
    }
  }

  return html`
    <li class="primer-row" data-minute=${Math.floor(word.first.start_seconds / 60)}>
      <div class="primer-head">
        <span
          class=${`token content-word primer-word mark-${status}`}
          onClick=${openPopup}
          onWheel=${(e) => wheel(e, e.currentTarget)}
        >${word.headword}</span>
        <span class="primer-reading">${word.reading}</span>
        <span class="primer-repeats">${repeats}</span>
        <span class="primer-ranks">
          ${jiten && html`<span class="pill">${jiten}</span>`}
          ${bccwj && html`<span class="pill">${bccwj}</span>`}
          <span class="pill muted">${met}</span>
        </span>
      </div>

      <div class="primer-example">
        <button
          class=${`play-btn ${isLoading ? 'loading' : ''}`}
          onClick=${play}
          disabled=${isLoading}
          title="Play the line it was first said in"
        >
          ${isPlaying ? '■' : isLoading ? '○' : '▶'}
        </button>
        <span class="timestamp">${word.first.timestamp}</span>
        ${!thumbFailed &&
        html`
          <img
            class="primer-thumb"
            src=${`/${videoId}/sentences/${sentenceId}/thumb`}
            alt=""
            loading="lazy"
            onError=${() => setThumbFailed(true)}
          />
        `}
        <span class="primer-sentence"
          >${before}<span class="primer-target">${surface}</span>${after}</span
        >
      </div>

      <div class="primer-actions">
        <button class="judge-btn yes" onClick=${() => judge('known')} title="I know this word">
          ✓ known
        </button>
        <button class="judge-btn no" onClick=${() => judge('unknown')} title="I do not know this word">
          ✗ unknown
        </button>
        ${mined
          ? html`
              <a
                class="mined-badge"
                href="#"
                onClick=${(e) => {
                  e.preventDefault();
                  browseMined();
                }}
                title="Already a card — open it in Anki"
              >
                ♦ mined
              </a>
            `
          : html`
              <button class="mine-btn" onClick=${mine} disabled=${mining} title="Make an Anki card from this line">
                ${mining ? '…' : '＋ Anki'}
              </button>
            `}
        <button class="translate-btn" onClick=${translate} disabled=${translating}>
          ${translating ? 'translating…' : 'translate'}
        </button>
        ${translation && html`<span class="primer-translation">${translation}</span>`}
      </div>
    </li>
  `;
}
