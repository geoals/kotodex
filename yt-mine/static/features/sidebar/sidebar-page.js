import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { submitUrl } from '../../api.js';
import { useJob } from '../mining/use-job.js';
import { visible } from '../mining/view.js';
import { JobStatus } from '../mining/job-status.js';
import { FilterBar } from '../mining/filter-bar.js';
import { SentenceList } from '../mining/sentence-list.js';
import { exportResult } from '../mining/state.js';
import { send } from './host.js';
import { useActiveSentence, useFollow } from './follow.js';
import { replay, useYoutubePlayback } from './playback.js';
import { useKeys } from './keys.js';
import { SidebarStats } from './stats.js';

const STATS_KEY = 'yt-mine.sidebar.stats';
// templates/spa.html reads the same key to stamp the theme before first paint.
const THEME_KEY = 'yt-mine.theme';

function storedStats() {
  try {
    return localStorage.getItem(STATS_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function SidebarPage({ videoId }) {
  const { job, error, missing, reload } = useJob(videoId);
  const [filter, setFilter] = useState('all');
  const kept = useRef(null);
  const [showStats, setShowStats] = useState(storedStats);

  function toggleStats() {
    const next = !showStats;
    setShowStats(next);
    try {
      localStorage.setItem(STATS_KEY, next ? 'shown' : 'hidden');
    } catch {}
  }

  const [theme, setTheme] = useState(document.documentElement.dataset.theme);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  useYoutubePlayback();
  useEffect(() => send('ready'), []);
  useEffect(() => {
    if (!exportResult.value) return;
    const timer = setTimeout(() => { exportResult.value = null; }, 4000);
    return () => clearTimeout(timer);
  }, [exportResult.value]);

  const sentences = job ? visible(job.sentences, filter, kept) : [];
  const active = useActiveSentence(sentences, job?.is_terminal);
  const { following, resume } = useFollow(active?.id);
  useKeys({ r: () => active && replay(active, videoId) });

  const themeTitle = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  let head;
  if (error) head = html`<div class="status error"><span class="progress-text">${error}</span></div>`;
  else if (missing) head = html`<${ProcessButton} videoId=${videoId} onSubmitted=${reload} />`;
  else if (!job) head = html`<div class="status"><span class="progress-text">Loading...</span></div>`;
  else if (job.status !== 'done') {
    head = html`
      <${JobStatus}
        status=${job.status}
        errorMessage=${job.error_message}
        progressPercent=${job.progress_percent}
      />
    `;
  }

  return html`
    <div class="yt-sidebar">
      <header>
        ${head}
        ${showStats && job?.sentences?.length > 0 && html`<${SidebarStats} job=${job} videoId=${videoId} />`}
        ${job?.sentences?.length > 0 && html`
          <div class="sidebar-bar">
            <${FilterBar} sentences=${job.sentences} filter=${filter} onFilter=${setFilter} />
            <button class="theme-toggle" onClick=${toggleTheme} title=${themeTitle}>${theme === 'light' ? '☾' : '☀'}</button>
            <button class="stats-toggle${showStats ? ' on' : ''}" onClick=${toggleStats} title="Show or hide the coverage figures and the difficulty curve">Stats</button>
            <a href=${`/${videoId}/primer`} target="_blank" title="Words to learn before watching">Primer ↗</a>
          </div>
        `}
      </header>
      ${job && html`
        <${SentenceList}
          sentences=${sentences}
          videoId=${videoId}
          jobId=${job.job_id}
          isTranscribing=${job.status === 'transcribing'}
          activeId=${active?.id}
          onSeek=${(s) => send('seek', { t: s.start_time })}
        />
      `}
      ${!following && active && html`
        <button class="follow-btn" onClick=${resume} title="Scroll back to the line playing now">
          ↓ Follow video
        </button>
      `}
    </div>
  `;
}

function ProcessButton({ videoId, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await submitUrl(`https://www.youtube.com/watch?v=${videoId}`);
      onSubmitted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return html`
    <div class="process">
      <button onClick=${start} disabled=${busy}>
        ${busy && html`<span class="spinner"></span>`}
        <span>Process video</span>
      </button>
      <p class="helper-text">Transcribes the whole video with whisper. Lines appear as it goes.</p>
      ${error && html`<p class="helper-text" style="color: var(--danger-text)">${error}</p>`}
    </div>
  `;
}
