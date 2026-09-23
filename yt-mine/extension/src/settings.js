// 127.0.0.1, not localhost: yt-mine listens on IPv4 and localhost can resolve
// to ::1 first.
export const DEFAULTS = {
  server: 'http://127.0.0.1:3000',
  collapsed: false,
};

export async function loadSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(patch) {
  return browser.storage.local.set(patch);
}
