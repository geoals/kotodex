import { useEffect, useRef, useState } from 'preact/hooks';
import { isOpen as popupOpen } from '../mining/popup.js';
import { on, playhead } from './host.js';
import { pinned } from './playback.js';

// timeupdate fires only about four times a second.
const LEAD = 0.25;
// Past the last transcribed line by this much, the playhead is in speech
// whisper has not reached yet.
const UNREACHED = 3;

/** The line under the playhead. Re-renders only when it changes, not on every
 * `timeupdate`, which would rebuild every row four times a second. */
export function useActiveSentence(sentences, complete) {
  const [active, setActive] = useState(null);
  const latest = useRef({ sentences, complete });
  latest.current = { sentences, complete };

  function update() {
    const { sentences, complete } = latest.current;
    const pin = pinned.peek();
    if (pin && sentences?.some((s) => s.id === pin.id)) return setActive(pin.id);
    setActive(activeSentence(sentences, playhead.peek().t, complete)?.id ?? null);
  }

  useEffect(() => {
    const offTime = playhead.subscribe(update);
    const offPin = pinned.subscribe(update);
    return () => {
      offTime();
      offPin();
    };
  }, []);
  useEffect(update, [sentences?.length, complete]);

  return sentences?.find((s) => s.id === active) ?? null;
}

function activeSentence(sentences, t, complete) {
  if (!sentences?.length) return null;
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start_time <= t + LEAD) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const line = sentences[found];
  const isLast = found === sentences.length - 1;
  if (isLast && !complete && t > line.end_time + UNREACHED) return null;
  return line;
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

// Stopped by the reader's input rather than by `scroll`, which cannot tell
// their scroll from ours. Held while the popup is open, or the word being read
// would move out from under it.
export function useFollow(activeId) {
  const [following, setFollowing] = useState(true);
  const wasPaused = useRef(playhead.peek().paused);

  useEffect(() => {
    const stop = () => setFollowing(false);
    const key = (e) => SCROLL_KEYS.has(e.key) && stop();
    const drag = (e) => e.target === document.documentElement && stop();
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', drag);
    const offJump = on('jump', () => setFollowing(true));
    const offPlay = playhead.subscribe(({ paused }) => {
      if (wasPaused.current && !paused) setFollowing(true);
      wasPaused.current = paused;
    });
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', key);
      window.removeEventListener('mousedown', drag);
      offJump();
      offPlay();
    };
  }, []);

  useEffect(() => {
    if (!following || activeId == null || popupOpen()) return;
    const row = document.querySelector(`.sentence-list > li[data-id="${activeId}"]`);
    if (!row) return;
    // An effect runs before the rows are laid out. scrollTo rather than
    // scrollIntoView, which scrolls YouTube's page as well as this frame.
    requestAnimationFrame(() => {
      const rect = row.getBoundingClientRect();
      const near = rect.bottom > -window.innerHeight && rect.top < window.innerHeight * 2;
      const top = rect.top + window.scrollY - (window.innerHeight - rect.height) / 2;
      window.scrollTo({ top, behavior: near ? 'smooth' : 'instant' });
    });
  }, [activeId, following]);

  return { following, resume: () => setFollowing(true) };
}
