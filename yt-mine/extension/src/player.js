/** The YouTube <video>, driven and reported on. `attach` swaps which element
 * it listens to, since YouTube can replace it between videos. */
export function createPlayer({ isAd }) {
  let video = null;
  let range = null;
  let ownSeek = false;
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
    if (video.currentTime >= range.end) {
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
      if (range && !range.pausing) endRange();
    },
    // On `seeking`, not `seeked`: the latter waits for the new position to
    // buffer, and the sidebar should move the moment the playhead does.
    seeking() {
      if (!ownSeek) endRange();
      report();
      emit('jump', video.currentTime);
    },
    seeked() {
      ownSeek = false;
      report();
    },
  };

  function seek(t) {
    if (!video) return;
    ownSeek = true;
    video.currentTime = Math.max(0, t);
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
      range = { end, pausing: false };
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
