// Everything that knows YouTube's DOM, so a YouTube redesign is fixed here.

export function videoId() {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

export function video() {
  return document.querySelector('#movie_player video');
}

export function mountPoint() {
  return (
    document.querySelector('ytd-watch-flexy #secondary-inner') ??
    document.querySelector('ytd-watch-flexy #secondary')
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
  style.textContent = `ytd-watch-flexy { --ytd-watch-flexy-sidebar-min-width: ${minPx}px !important; }`;
  document.head.append(style);
}

export function toggleFullscreen() {
  document.querySelector('#movie_player .ytp-fullscreen-button')?.click();
}

export function onNavigate(fn) {
  document.addEventListener('yt-navigate-finish', fn);
  window.addEventListener('popstate', fn);
}

export function watchPageReady() {
  return new Promise((resolve) => {
    if (mountPoint() && video()) return resolve();
    const observer = new MutationObserver(() => {
      if (!mountPoint() || !video()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}
