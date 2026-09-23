// The YouTube tab this page is framed in, as the extension speaks for it.
// The message shapes are listed in extension/README.md; the extension's
// src/bridge.js is the other end.

import { signal } from '@preact/signals';

const NS = 'yt-mine/sidebar';
const HOST_ORIGIN = 'https://www.youtube.com';

export const playhead = signal({ t: 0, paused: true });

const handlers = new Map();

/** Returns the unsubscribe. */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}

export function send(type, body = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ ns: NS, type, ...body }, HOST_ORIGIN);
}

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || e.origin !== HOST_ORIGIN) return;
  const msg = e.data;
  if (msg?.ns !== NS) return;
  if (msg.type === 'time') playhead.value = { t: msg.t, paused: msg.paused };
  for (const fn of handlers.get(msg.type) ?? []) fn(msg);
});
