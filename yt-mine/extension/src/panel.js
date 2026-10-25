import { saveSettings } from './settings.js';

// A page that never says `ready` is a server that is not running: a refused
// connection in a cross-origin frame raises nothing the parent can see.
const READY_TIMEOUT_MS = 4000;

export function createPanel(settings, { onLoad }) {
  const root = el('div', 'yt-mine-panel');
  const bar = el('div', 'yt-mine-bar');
  const title = el('span', 'yt-mine-title', 'yt-mine');
  const toggle = el('button', 'yt-mine-toggle');
  const notice = el('div', 'yt-mine-notice');
  const frame = document.createElement('iframe');
  frame.className = 'yt-mine-frame';
  bar.append(title, toggle);
  root.append(bar, notice, frame);

  let collapsed = settings.collapsed;
  let src = null;
  let readyTimer = null;

  function render() {
    root.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.title = collapsed ? 'Show transcript' : 'Hide transcript';
  }

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    saveSettings({ collapsed });
    render();
  });

  function load(url) {
    src = url;
    onLoad();
    frame.src = url;
    notice.hidden = true;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(unreachable, READY_TIMEOUT_MS);
  }

  function unreachable() {
    notice.replaceChildren(
      el('p', null, `yt-mine is not answering at ${settings.server}.`),
      el('p', null, 'If Firefox asked to let YouTube access this device, see the extension README.'),
      el('p', null, 'Otherwise start it: scripts/start-all.sh start yt-mine'),
    );
    const retry = el('button', null, 'Retry');
    retry.addEventListener('click', () => load(src));
    notice.append(retry);
    notice.hidden = false;
  }

  render();

  return {
    frame,
    show(videoId, mountPoint) {
      if (mountPoint && root.parentNode !== mountPoint) mountPoint.prepend(root);
      root.hidden = false;
      const url = `${settings.server}/${encodeURIComponent(videoId)}/sidebar`;
      if (url !== src) load(url);
    },
    hide() {
      root.hidden = true;
    },
    docked(on) {
      root.classList.toggle('docked', on);
    },
    get visible() {
      return !root.hidden;
    },
    ready() {
      clearTimeout(readyTimer);
      notice.hidden = true;
    },
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
