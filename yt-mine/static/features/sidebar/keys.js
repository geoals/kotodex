import { useEffect, useRef } from 'preact/hooks';
import { send } from './host.js';

// Once the sidebar has been clicked it holds the keyboard, and YouTube's own
// keys stop working; these are the ones worth having back.
const HOST_KEYS = {
  ' ': ['toggle-play'],
  k: ['toggle-play'],
  ArrowLeft: ['nudge', { by: -5 }],
  ArrowRight: ['nudge', { by: 5 }],
  j: ['nudge', { by: -10 }],
  l: ['nudge', { by: 10 }],
  f: ['fullscreen'],
};

/** `local` maps a key to something the page does itself, ahead of HOST_KEYS. */
export function useKeys(local) {
  const own = useRef(local);
  own.current = local;
  useEffect(() => {
    function handle(e) {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const mine = own.current[e.key];
      const forwarded = HOST_KEYS[e.key];
      if (!mine && !forwarded) return;
      e.preventDefault();
      // Space on a focused button would also click it on keyup.
      if (e.target instanceof HTMLButtonElement) e.target.blur();
      if (mine) mine();
      else send(...forwarded);
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
}
