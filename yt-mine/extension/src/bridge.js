const NS = 'yt-mine/sidebar';

export function createBridge(frame, server) {
  const origin = new URL(server).origin;
  const handlers = new Map();
  // Until the page says so, the frame may still be about:blank, which has
  // YouTube's origin and refuses the message.
  let ready = false;

  window.addEventListener('message', (e) => {
    if (e.origin !== origin) return;
    const msg = e.data;
    if (msg?.ns !== NS) return;
    if (msg.type === 'ready') ready = true;
    for (const fn of handlers.get(msg.type) ?? []) fn(msg);
  });

  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    reset() {
      ready = false;
    },
    send(type, body = {}) {
      if (!ready) return;
      frame.contentWindow?.postMessage({ ns: NS, type, ...body }, origin);
    },
  };
}
