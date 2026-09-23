// Content scripts cannot be modules; importing one is how the rest can be.
import(browser.runtime.getURL('src/main.js')).catch((err) => console.error('[yt-mine]', err));
