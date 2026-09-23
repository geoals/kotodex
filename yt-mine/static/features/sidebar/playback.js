
import { useEffect } from 'preact/hooks';
import { audioState } from '../mining/state.js';
import { on, send } from './host.js';

const IDLE = { playing: false, loading: false, sentenceId: null };

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
      send('play-range', { start, end });
    }
    window.addEventListener('play-sentence', play);
    const off = on('range-end', () => { audioState.value = IDLE; });
    return () => {
      window.removeEventListener('play-sentence', play);
      off();
    };
  }, []);
}

export function replay(sentence, videoId) {
  window.dispatchEvent(new CustomEvent('play-sentence', {
    detail: { videoId, sentenceId: sentence.id, start: sentence.start_time, end: sentence.end_time },
  }));
}
