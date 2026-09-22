import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { judged } from '../mining/state.js';
import { difficulty, seriesValue, formatValue, SERIES } from './difficulty.js';

const W = 720;
const H = 120;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;

function niceCeiling(max, series) {
  if (series === 'firsts') return Math.max(5, Math.ceil(max / 5) * 5);
  return Math.min(1, Math.max(0.1, Math.ceil(max * 10) / 10));
}

function axisLabel(value, series) {
  return series === 'firsts' ? String(value) : `${Math.round(value * 100)}%`;
}

export function DifficultyChart({ words, minutes, series, onSeries, onPick }) {
  const marks = judged.value;
  const [hover, setHover] = useState(null);

  const buckets = difficulty(words, minutes, marks);
  if (buckets.length < 2) return null;

  const top = niceCeiling(Math.max(...buckets.map((b) => seriesValue(b, series))), series);
  const lastMinute = buckets[buckets.length - 1].minute;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const x = (minute) => PAD_L + (minute / lastMinute) * plotW;
  const y = (value) => PAD_T + plotH - (value / top) * plotH;

  const points = buckets.map((b) => `${x(b.minute)},${y(seriesValue(b, series))}`);
  const line = `M${points.join('L')}`;
  const area = `${line}L${x(lastMinute)},${y(0)}L${x(0)},${y(0)}Z`;

  const band = plotW / buckets.length;

  const peak = buckets.reduce((a, b) =>
    seriesValue(b, series) > seriesValue(a, series) ? b : a,
  );
  const shown = hover ?? peak;
  const readout = `${shown.minute}m · ${formatValue(shown, series)}`;
  const detail = `${shown.unknown}/${shown.total} words`;

  return html`
    <div class="difficulty">
      <div class="difficulty-head">
        <div class="difficulty-readout">
          <span class="difficulty-value">${readout}</span>
          <span class="difficulty-detail">${detail}</span>
        </div>
        <div class="segmented" role="group">
          ${SERIES.map(
            ([id, label]) => html`
              <button class=${series === id ? 'on' : ''} onClick=${() => onSeries(id)}>
                <span>${label}</span>
              </button>
            `,
          )}
        </div>
      </div>

      <svg
        class="difficulty-plot"
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="none"
        role="img"
        aria-label=${`Difficulty across the video, by ${series === 'firsts' ? 'new words' : 'unknown share'} per minute`}
        onMouseLeave=${() => setHover(null)}
      >
        ${[0, 0.5, 1].map((f) => {
          const value = top * f;
          return html`
            <g>
              <line
                class="difficulty-grid"
                x1=${PAD_L}
                x2=${W - PAD_R}
                y1=${y(value)}
                y2=${y(value)}
              />
              <text class="difficulty-tick" x=${PAD_L - 6} y=${y(value) + 3} text-anchor="end">
                ${axisLabel(value, series)}
              </text>
            </g>
          `;
        })}

        <path class="difficulty-area" d=${area} />
        <path class="difficulty-line" d=${line} />

        ${hover &&
        html`
          <line
            class="difficulty-crosshair"
            x1=${x(hover.minute)}
            x2=${x(hover.minute)}
            y1=${PAD_T}
            y2=${PAD_T + plotH}
          />
          <circle
            class="difficulty-dot"
            cx=${x(hover.minute)}
            cy=${y(seriesValue(hover, series))}
            r="4"
          />
        `}

        ${buckets.map(
          (b) => html`
            <rect
              class="difficulty-hit"
              x=${x(b.minute) - band / 2}
              y=${PAD_T}
              width=${Math.max(band, 6)}
              height=${plotH}
              onMouseEnter=${() => setHover(b)}
              onFocus=${() => setHover(b)}
              onClick=${() => onPick(b.minute)}
              tabindex="0"
              role="button"
              aria-label=${`${b.minute} minutes in, ${formatValue(b, series)}`}
            />
          `,
        )}

        <text class="difficulty-tick" x=${PAD_L} y=${H - 5}>0m</text>
        <text class="difficulty-tick" x=${W - PAD_R} y=${H - 5} text-anchor="end">
          ${`${lastMinute}m`}
        </text>
      </svg>
    </div>
  `;
}
