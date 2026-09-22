import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchPrimer } from '../../api.js';
import { judged } from '../mining/state.js';
import { ExportResult } from '../mining/export-result.js';
import { Tabs } from '../../tabs.js';
import { PrimerBar } from './primer-bar.js';
import { PrimerRow } from './primer-row.js';
import { DifficultyChart } from './difficulty-chart.js';
import { countsByThreshold, visibleWords } from './words.js';

const MAX_THRESHOLD = 10;

export function PrimerPage({ videoId }) {
  const [primer, setPrimer] = useState(null);
  const [error, setError] = useState(null);
  const [threshold, setThreshold] = useState(2);
  const [sort, setSort] = useState('time');
  const [series, setSeries] = useState('share');
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setPrimer(null);
    setError(null);
    fetchPrimer(videoId)
      .then((p) => !cancelled && setPrimer(p))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (error) {
    return html`
      <${Tabs} videoId=${videoId} active="primer" />
      <div class="status error">${error}</div>
    `;
  }
  if (!primer) {
    return html`
      <${Tabs} videoId=${videoId} active="primer" />
      <div class="status">Building the primer...</div>
    `;
  }

  const marks = judged.value;
  const counts = countsByThreshold(primer.words, MAX_THRESHOLD, marks);
  const rows = visibleWords(primer.words, threshold, sort, marks);

  function scrollToMinute(minute) {
    const list = listRef.current;
    if (!list) return;
    const row = [...list.children].find((li) => Number(li.dataset.minute) >= minute);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const left = `${counts[1] ?? 0} words left to judge`;

  return html`
    <${Tabs} videoId=${videoId} active="primer" />
    ${primer.video_title && html`<h2>${primer.video_title}</h2>`}
    <p class="primer-summary">${left}</p>

    <${DifficultyChart}
      words=${primer.words}
      minutes=${primer.minutes}
      series=${series}
      onSeries=${setSeries}
      onPick=${scrollToMinute}
    />

    <${PrimerBar}
      threshold=${threshold}
      max=${MAX_THRESHOLD}
      counts=${counts}
      sort=${sort}
      onThreshold=${setThreshold}
      onSort=${setSort}
    />

    <${ExportResult} />

    <ul class="primer-list" ref=${listRef}>
      ${rows.map(
        (word) => html`
          <${PrimerRow}
            key=${`${word.headword} ${word.reading}`}
            word=${word}
            videoId=${videoId}
            jobId=${primer.job_id}
          />
        `,
      )}
    </ul>
    ${!rows.length && html`<div class="status">Nothing left at this threshold.</div>`}
  `;
}
