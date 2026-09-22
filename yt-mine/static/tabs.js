import { html } from 'htm/preact';
import { navigate } from './router.js';

const TABS = [
  ['video', 'Transcript', (id) => `/${id}`],
  ['primer', 'Primer', (id) => `/${id}/primer`],
];

export function Tabs({ videoId, active }) {
  return html`
    <nav class="site-nav">
      ${TABS.map(([id, label, href]) => {
        const url = href(videoId);
        return html`
          <a
            class=${active === id ? 'on' : ''}
            href=${url}
            onClick=${(e) => {
              e.preventDefault();
              navigate(url);
            }}
          >
            ${label}
          </a>
        `;
      })}
    </nav>
  `;
}
