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
