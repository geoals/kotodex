import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { submitUrl, submitLocal } from '../../api.js';
import { navigate } from '../../router.js';

export function SubmitForm() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { video_id, at } = await submitUrl(url);
      navigate(at ? `/${video_id}?t=${Math.round(at)}` : `/${video_id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return html`
    <form onSubmit=${handleSubmit}>
      <input
        type="url"
        name="url"
        placeholder="https://www.youtube.com/watch?v=..."
        value=${url}
        onInput=${(e) => setUrl(e.target.value)}
        required
      />
      <p class="helper-text">
        Right-click the video → <b>Copy link at current time</b>, and the page
        opens on the line you were watching.
      </p>
      <button type="submit" disabled=${submitting}>
        ${submitting && html`<span class="spinner"></span>`}
        <span>Mine sentences</span>
      </button>
      ${error && html`<p class="helper-text" style="color: var(--danger-text)">${error}</p>`}
    </form>
  `;
}

export function LocalForm() {
  const [video, setVideo] = useState('');
  const [subtitles, setSubtitles] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { video_id } = await submitLocal(video, subtitles);
      navigate(`/${video_id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return html`
    <form class="local-form" onSubmit=${handleSubmit}>
      <p class="helper-text"><b>Or a local episode</b></p>
      <input
        type="text"
        placeholder="/path/to/episode.mkv"
        value=${video}
        onInput=${(e) => setVideo(e.target.value)}
        required
      />
      <input
        type="text"
        placeholder="/path/to/episode.srt (optional)"
        value=${subtitles}
        onInput=${(e) => setSubtitles(e.target.value)}
      />
      <p class="helper-text">
        Subtitles: .srt or .ass. Leave empty to use the file beside the video with the same name, or the Japanese track inside it.
      </p>
      <button type="submit" disabled=${submitting}>
        ${submitting && html`<span class="spinner"></span>`}
        <span>Mine sentences</span>
      </button>
      ${error && html`<p class="helper-text" style="color: var(--danger-text)">${error}</p>`}
    </form>
  `;
}
