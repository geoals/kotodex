/** The YouTube <video>, driven and reported on. `attach` swaps which element
 * it listens to, since YouTube can replace it between videos. */
export function createPlayer({ isAd, seekTo }) {
  let video = null;
  let range = null;
  const listeners = { time: [], jump: [], rangeEnd: [] };
  const emit = (name, ...args) => listeners[name].forEach((fn) => fn(...args));

  function report() {
    if (!video || isAd()) return;
    emit('time', video.currentTime, video.paused);
  }

  function endRange() {
    if (!range) return;
    range = null;
    emit('rangeEnd');
  }

  // rAF rather than timeupdate, which fires only every quarter second and
  // would run a quarter second into the next line.
  function watchRange() {
    if (!range || !video) return;
    const t = video.currentTime;
    if (!range.landed) {
      // A seek to a position YouTube has not buffered is asynchronous, and
      // until it lands the playhead is still where it was.
      range.landed = t >= range.start - 0.3 && t < range.end;
      if (!range.landed && performance.now() > range.giveUpAt) return endRange();
    } else if (t >= range.end) {
      range.pausing = true;
      video.pause();
      endRange();
      return;
    }
    requestAnimationFrame(watchRange);
  }

  const events = {
    timeupdate: report,
    play: report,
    pause() {
      report();
      if (range?.landed && !range.pausing) endRange();
    },
    // On `seeking`, not `seeked`: the latter waits for the new position to
    // buffer, and the sidebar should move the moment the playhead does. The
    // range's own seek fires this too, often after it has landed.
    seeking() {
      const t = video.currentTime;
      if (range && (t < range.start - 0.5 || t > range.end)) endRange();
      report();
      emit('jump', video.currentTime);
    },
    seeked: report,
  };

  function seek(t) {
    if (video) seekTo(video, Math.max(0, t));
  }

  return {
    attach(next) {
      if (next === video) return;
      endRange();
      for (const [name, fn] of Object.entries(events)) {
        video?.removeEventListener(name, fn);
        next?.addEventListener(name, fn);
      }
      video = next;
      report();
    },
    report,
    time: () => video?.currentTime ?? 0,
    seek,
    nudge(by) {
      endRange();
      seek(this.time() + by);
    },
    toggle() {
      if (!video) return;
      endRange();
      if (video.paused) video.play();
      else video.pause();
    },
    playRange(start, end) {
      if (!video) return;
      range = { start, end, landed: false, pausing: false, giveUpAt: performance.now() + 15000 };
      seek(start);
      video.play();
      requestAnimationFrame(watchRange);
    },
    stopRange() {
      if (!range) return;
      range.pausing = true;
      video.pause();
      endRange();
    },
    on(name, fn) {
      listeners[name].push(fn);
    },
  };
}
