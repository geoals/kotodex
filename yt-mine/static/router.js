import { signal } from '@preact/signals';

export const route = signal(parseRoute());

function parseRoute() {
  const path = window.location.pathname;

  if (path === '/' || path === '') {
    return { page: 'home' };
  }

  const [videoId, section, ...rest] = path.slice(1).split('/');
  if (!videoId || rest.length) {
    return { page: 'home' };
  }

  // A real path rather than a tab signal, so the primer survives a reload and
  // can be linked to — the same reason `?t=` is in the URL and not in state.
  if (section === 'primer') {
    return { page: 'primer', videoId };
  }
  if (!section) {
    // `?t=` is where the page opens. It survives a reload and a copied link,
    // which a signal would not.
    const t = Number(new URLSearchParams(window.location.search).get('t'));
    return { page: 'video', videoId, at: Number.isFinite(t) && t > 0 ? t : null };
  }

  return { page: 'home' };
}

export function navigate(path) {
  window.history.pushState(null, '', path);
  route.value = parseRoute();
}

window.addEventListener('popstate', () => {
  route.value = parseRoute();
});
