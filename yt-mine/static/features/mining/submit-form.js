import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { submitUrl, submitLocal, pickLocal } from '../../api.js';
import { navigate } from '../../router.js';

export function SubmitForm() {
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function choose() {
    setError(null);
    setPicking(true);
    try {
      const picked = await pickLocal();
      if (picked) {
        setVideo(picked);
        setUrl('');
      }
    } catch (err) {
      setError(err.message);
    }
    setPicking(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (video) {
        const { video_id } = await submitLocal(video.path);
        navigate(`/${video_id}`);
      } else {
        const { video_id, at } = await submitUrl(url);
        navigate(at ? `/${video_id}?t=${Math.round(at)}` : `/${video_id}`);
      }
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const subtitleInfo = video?.subtitles
    ? `Subtitles found: ${video.subtitles}`
    : 'No subtitles found. The audio will be transcribed by speech-to-text.';

  return html`
    <form onSubmit=${handleSubmit}>
      <input
        type="url"
        name="url"
        placeholder="https://www.youtube.com/watch?v=..."
        value=${url}
        onInput=${(e) => {
          setUrl(e.target.value);
          setVideo(null);
        }}
      />
      <p class="helper-text">
        Right-click the video → <b>Copy link at current time</b>, and the page
        opens on the line you were watching.
      </p>
      <p class="helper-text"><b>Or a local video</b></p>
      <div class="local-pick">
        <button type="button" onClick=${choose} disabled=${picking}>
          ${picking && html`<span class="spinner"></span>`}
          <span>Choose video…</span>
        </button>
        ${video && html`<span class="local-name">${video.name}</span>`}
      </div>
      ${video && html`<p class="helper-text">${subtitleInfo}</p>`}
      <button type="submit" disabled=${submitting || (!url && !video)}>
        ${submitting && html`<span class="spinner"></span>`}
        <span>Mine sentences</span>
      </button>
      ${error && html`<p class="helper-text" style="color: var(--danger-text)">${error}</p>`}
    </form>
  `;
}
