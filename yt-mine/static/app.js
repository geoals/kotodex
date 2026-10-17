import { render } from 'preact';
import { html } from 'htm/preact';
import { route, navigate } from './router.js';
import { SubmitForm, LocalForm } from './features/mining/submit-form.js';
import { VideoHistory } from './features/mining/video-history.js';
import { VideoPage } from './features/mining/video-page.js';
import { AudioPlayer } from './features/mining/audio-player.js';
import { PrimerPage } from './features/primer/primer-page.js';
import { SidebarPage } from './features/sidebar/sidebar-page.js';

function App() {
  const { page, videoId, at } = route.value;
  if (page === 'sidebar') return html`<${SidebarPage} videoId=${videoId} />`;

  return html`
    <h1><a href="/">yt-mine</a></h1>
    ${page === 'home' && html`<${SubmitForm} /><${LocalForm} /><${VideoHistory} />`}
    ${page === 'video' && html`<${VideoPage} videoId=${videoId} at=${at} />`}
    ${page === 'primer' && html`<${PrimerPage} videoId=${videoId} />`}
    <${AudioPlayer} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
