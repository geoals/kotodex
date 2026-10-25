// Everything that knows YouTube's DOM, so a YouTube redesign is fixed here.

export function videoId() {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

export function video() {
  return document.querySelector('#movie_player video');
}

// Two watch layouts are live at once: ytd-watch-grid and the older
// ytd-watch-flexy. Both have the same side column.
const WATCH = 'ytd-watch-grid, ytd-watch-flexy';

export function mountPoint() {
  return (
    document.querySelector(`:is(${WATCH}) #secondary-inner`) ??
    document.querySelector(`:is(${WATCH}) #secondary`)
  );
}

// An ad plays in the same <video> element, on its own clock.
export function adPlaying() {
  return document.querySelector('#movie_player')?.classList.contains('ad-showing') ?? false;
}

// Through the player's own API: setting currentTime past what YouTube has
// buffered is ignored, and the video carries on from where it was.
export function seekTo(video, t) {
  const api = document.querySelector('#movie_player')?.wrappedJSObject;
  if (typeof api?.seekTo === 'function') api.seekTo(t, true);
  else video.currentTime = t;
}

// The column shrinks to 320px on a narrow window, too tight for a transcript
// line and the popup. Only the floor moves; a wide window keeps YouTube's width.
export function widenSideColumn(minPx) {
  const style = document.createElement('style');
  // ytd-watch-grid sets its column width inline and has no floor variable.
  style.textContent = `
    ytd-watch-flexy { --ytd-watch-flexy-sidebar-min-width: ${minPx}px !important; }
    ytd-watch-grid #secondary { min-width: ${minPx}px; }
  `;
  document.head.append(style);
}

// The vertical rail beside the side column (Description, Comments, …).
export function sideRail() {
  return document.querySelector('#fixed-side-menu .ytSideRailViewModelTablist');
}

// A copy of the rail's first button, so ours matches YouTube's styling. The
// rail is re-rendered by YouTube, so callers re-add the button when it is gone.
export function watchElement() {
  return document.querySelector('ytd-watch-flexy, ytd-watch-grid');
}

// Where a side-rail panel (Description, Comments) is drawn.
export function railPanelContainer() {
  const watch = watchElement();
  return watch?.querySelector('#fixed-secondary #panels') ?? watch?.querySelector('#panels') ?? null;
}

export function railPanelOpen() {
  return watchElement()?.hasAttribute('fixed-panel-expanded') ?? false;
}

// The rail's buttons are wrappers; the handler is on the <button> inside.
export function pressRailButton(button) {
  (button.querySelector('button') ?? button).click();
}

export function nativeRailButtons(rail) {
  return [...rail.querySelectorAll('.ytSideRailViewModelButton:not(.yt-mine-rail-button)')];
}

export function makeRailButton(rail, label, glyph) {
  const model = rail.querySelector('.ytSideRailViewModelButton');
  const button = model ? model.cloneNode(true) : document.createElement('button');
  button.classList.add('yt-mine-rail-button');
  button.removeAttribute('id');
  button.querySelectorAll('[aria-selected], [aria-pressed]').forEach((n) => {
    n.removeAttribute('aria-selected');
    n.removeAttribute('aria-pressed');
  });
  const icon = button.querySelector('yt-icon, .yt-spec-button-shape-next__icon, svg');
  if (icon) {
    const g = document.createElement('span');
    g.className = 'yt-mine-rail-glyph';
    g.textContent = glyph;
    icon.replaceWith(g);
  }
  const text = [...button.querySelectorAll('*')].find(
    (n) => n.children.length === 0 && n.textContent.trim(),
  );
  if (text) text.textContent = label;
  else button.append(label);
  button.querySelectorAll('[aria-label]').forEach((n) => n.setAttribute('aria-label', label));
  button.title = label;
  return button;
}

export function toggleFullscreen() {
  document.querySelector('#movie_player .ytp-fullscreen-button')?.click();
}

export function onNavigate(fn) {
  document.addEventListener('yt-navigate-finish', fn);
  window.addEventListener('popstate', fn);
}

export function watchPageReady() {
  const ready = () => video() && (mountPoint() || sideRail());
  return new Promise((resolve) => {
    if (ready()) return resolve();
    const observer = new MutationObserver(() => {
      if (!ready()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
