import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { judgeWords, suggestKnown } from '../../api.js';
import { judged } from './state.js';

const WHY = {
  loanword: 'Loanword',
  common: 'Common',
  compound: 'Compound',
  name: 'Name',
};

// The model proposes and the reader decides: nothing is written until the
// reader confirms, and only the words left on yes.
export function SuggestKnown({ videoId }) {
  const [state, setState] = useState('idle');
  const [candidates, setCandidates] = useState([]);
  const [rejected, setRejected] = useState(new Set());
  const [note, setNote] = useState(null);

  async function ask() {
    setState('asking');
    setNote(null);
    try {
      const res = await suggestKnown(videoId);
      setCandidates(res.candidates);
      setRejected(new Set());
      if (res.candidates.length) setState('review');
      else {
        setState('idle');
        setNote(res.asked ? `None of ${res.asked} unjudged words picked.` : 'No unjudged words.');
      }
    } catch (err) {
      setState('idle');
      setNote(`Error: ${err.message}`);
    }
  }

  function flip(key) {
    const next = new Set(rejected);
    next.has(key) ? next.delete(key) : next.add(key);
    setRejected(next);
  }

  async function confirm() {
    const words = candidates
      .filter((c) => !rejected.has(wordKey(c)))
      .map(({ headword, reading }) => ({ headword, reading }));
    if (!words.length) return close();
    setState('saving');
    if (!(await judgeWords(words, 'known'))) {
      setState('review');
      setNote('Error: could not save.');
      return;
    }
    const marks = new Map(judged.value);
    for (const w of words) marks.set(wordKey(w), 'known');
    judged.value = marks;
    close();
    setNote(`Marked ${words.length} known.`);
  }

  function close() {
    setState('idle');
    setCandidates([]);
  }

  if (state === 'idle' || state === 'asking') {
    const asking = state === 'asking';
    return html`
      <div class="suggest-known">
        <button class="quiet" onClick=${ask} disabled=${asking} title="Ask the model which unjudged words you likely know">
          ${asking && html`<span class="spinner"></span>`}
          <span>${asking ? 'Asking...' : 'Find words I likely know'}</span>
        </button>
        ${note && html`<span class="suggest-note">${note}</span>`}
      </div>
    `;
  }

  const yes = candidates.length - rejected.size;
  const label = `Mark ${yes} known`;

  return html`
    <div class="suggest-known review">
      <ul class="suggest-list">
        ${candidates.map((c) => {
          const k = wordKey(c);
          const on = !rejected.has(k);
          const { text, start, len } = c.first;
          const count = `×${c.count}`;
          return html`
            <li key=${k} class=${on ? '' : 'off'}>
              <div class="suggest-head">
                <span class="suggest-word">${c.headword}</span>
                <span class="suggest-reading">${c.reading}</span>
                <span class="suggest-why">${WHY[c.why] ?? c.why}</span>
                <span class="suggest-count">${count}</span>
                <div class="segmented" role="group">
                  <button class=${on ? 'on' : ''} onClick=${() => on || flip(k)}><span>Yes</span></button>
                  <button class=${on ? '' : 'on'} onClick=${() => on && flip(k)}><span>No</span></button>
                </div>
              </div>
              <div class="suggest-line">
                ${text.slice(0, start)}<b>${text.slice(start, start + len)}</b>${text.slice(start + len)}
              </div>
            </li>
          `;
        })}
      </ul>
      <div class="suggest-actions">
        ${note && html`<span class="suggest-note">${note}</span>`}
        <button class="quiet" onClick=${close} disabled=${state === 'saving'}><span>Cancel</span></button>
        <button onClick=${confirm} disabled=${state === 'saving'}><span>${label}</span></button>
      </div>
    </div>
  `;
}

function wordKey(w) {
  return `${w.headword} ${w.reading}`;
}
