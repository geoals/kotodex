import { html } from 'htm/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { useJob } from './use-job.js';
import { JobStatus } from './job-status.js';
import { SentenceList } from './sentence-list.js';
import { FilterBar } from './filter-bar.js';
import { ComprehensionPanel } from './comprehension-panel.js';
import { SuggestKnown } from './suggest-known.js';
import { visible } from './view.js';
import { Tabs } from '../../tabs.js';

export function VideoPage({ videoId, at }) {
  const { job, error, missing } = useJob(videoId);
  const [filter, setFilter] = useState('all');
  const kept = useRef(null);
  // The list arrives one fetch after the page does, and grows while whisper
  // runs, so landing on the line is a one-shot that waits for it to exist.
  const landed = useRef(false);

  // Whisper transcribes from 0:00, so the line a `t=` link points at does not
  // exist for as long as it takes to reach it — minutes, for a timestamp late
  // in a video. Every poll is another attempt, and `landed` is only set once
  // the row was actually found and scrolled to.
  useEffect(() => {
    if (!at || landed.current || !job?.sentences?.length) return;
    if (!job.is_terminal && lastStart(job.sentences) < at) return;
    landed.current = scrollToTime(at);
  }, [at, job?.sentence_count, job?.is_terminal]);

  if (error || missing) {
    return html`
      <${Tabs} videoId=${videoId} active="video" />
      <div class="status error"><span class="progress-text">${error ?? 'Not processed yet.'}</span></div>
    `;
  }

  if (!job) {
    return html`
      <${Tabs} videoId=${videoId} active="video" />
      <div class="status"><span class="progress-text">Loading...</span></div>
    `;
  }

  const isDone = job.status === 'done';
  const isTranscribing = job.status === 'transcribing';

  return html`
    <${Tabs} videoId=${videoId} active="video" />
    ${job.video_title && html`<h2>${job.video_title}</h2>`}
    <${JobStatus}
      status=${job.status}
      errorMessage=${job.error_message}
      progressPercent=${job.progress_percent}
      waitingFor=${at && !landed.current ? at : null}
    />
    ${job.sentences?.length > 0 && html`
      <${ComprehensionPanel} sentences=${job.sentences} partial=${!job.is_terminal} />
      ${isDone && html`<${SuggestKnown} videoId=${videoId} />`}
      <${FilterBar} sentences=${job.sentences} filter=${filter} onFilter=${setFilter} />
    `}
    <${SentenceList}
      sentences=${visible(job.sentences, filter, kept)}
      videoId=${videoId}
      jobId=${job.job_id}
      isDone=${isDone}
      isTranscribing=${isTranscribing}
    />
  `;
}

function lastStart(sentences) {
  return sentences[sentences.length - 1]?.start_seconds ?? 0;
}

// The first line at or after `seconds`, centred and outlined so it is
// findable in a list of several hundred. Returns whether it found one.
//
// The scroll itself is deferred a frame: this runs from an effect, so Preact
// has committed the rows, but the browser has not laid them out yet and
// `scrollIntoView` on an unlaid-out list lands nowhere.
function scrollToTime(seconds) {
  const rows = [...document.querySelectorAll('.sentence-list > li[data-start]')];
  const row = rows.find((r) => Number(r.dataset.start) >= seconds - 1);
  if (!row) return false;
  requestAnimationFrame(() => {
    row.scrollIntoView({ block: 'center' });
    row.classList.add('landed');
  });
  return true;
}
