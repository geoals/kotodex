import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { audioState } from '../mining/state.js';
import { on, playhead, send } from './host.js';

const IDLE = { playing: false, loading: false, sentenceId: null };

// The replay pauses at the line's end, which is where the next line starts, so
// without this the next line would take over the moment the replay finishes.
// It holds until the video plays on or jumps elsewhere.
export const pinned = signal(null);

export function useYoutubePlayback() {
  useEffect(() => {
    function play(e) {
      const { sentenceId, start, end } = e.detail;
      const current = audioState.value;
      if (current.playing && current.sentenceId === sentenceId) {
        send('stop-range');
        audioState.value = IDLE;
        return;
      }
      audioState.value = { playing: true, loading: false, sentenceId };
      pinned.value = { id: sentenceId, start, end };
      send('play-range', { start, end });
    }
    window.addEventListener('play-sentence', play);
    const offEnd = on('range-end', () => { audioState.value = IDLE; });
    const offJump = on('jump', ({ t }) => {
      const pin = pinned.peek();
      if (pin && (t < pin.start - 0.5 || t > pin.end + 0.5)) pinned.value = null;
    });
    const offPlay = playhead.subscribe(({ paused }) => {
      if (!paused && !audioState.peek().playing) pinned.value = null;
    });
    return () => {
      window.removeEventListener('play-sentence', play);
      offEnd();
      offJump();
      offPlay();
    };
  }, []);
}

export function replay(sentence, videoId) {
  window.dispatchEvent(new CustomEvent('play-sentence', {
    detail: { videoId, sentenceId: sentence.id, start: sentence.start_time, end: sentence.end_time },
  }));
}
