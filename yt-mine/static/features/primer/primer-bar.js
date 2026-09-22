import { html } from 'htm/preact';
import { SORTS } from './words.js';

const TITLES = {
  time: 'In the order the video says them',
  count: 'Most repeated first — what the video is about',
  rank: 'Commonest first, by whichever corpus ranks it higher',
};

export function PrimerBar({ threshold, max, counts, sort, onThreshold, onSort }) {
  const shown = counts[threshold] ?? 0;
  const readout = `${shown} words, said ${threshold}× or more`;

  return html`
    <div class="toolbar primer-bar">
      <label class="threshold-control">
        <input
          type="range"
          min="1"
          max=${max}
          step="1"
          value=${threshold}
          onInput=${(e) => onThreshold(Number(e.target.value))}
        />
        <span class="threshold-value">${readout}</span>
      </label>

      <div class="segmented" role="group">
        ${SORTS.map(
          ([id, label]) => html`
            <button class=${sort === id ? 'on' : ''} onClick=${() => onSort(id)} title=${TITLES[id]}>
              <span>${label}</span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}
