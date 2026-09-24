import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { fetchPrimer } from '../../api.js';
import { ComprehensionPanel } from '../mining/comprehension-panel.js';
import { DifficultyChart } from '../primer/difficulty-chart.js';
import { send } from './host.js';

// The transcript page's tiles and the primer's curve, above the list.
//
// The curve waits for the transcript to finish: the server rebuilds the primer
// whenever the sentence count moves, and during transcription that is every poll.
export function SidebarStats({ job, videoId }) {
  const [primer, setPrimer] = useState(null);
  const [series, setSeries] = useState('share');
  const ready = job.is_terminal && job.status === 'done';

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchPrimer(videoId)
      .then((p) => !cancelled && setPrimer(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId, ready]);

  return html`
    <div class="sidebar-stats">
      <${ComprehensionPanel} sentences=${job.sentences} partial=${!job.is_terminal} />
      ${primer && html`
        <${DifficultyChart}
          words=${primer.words}
          minutes=${primer.minutes}
          series=${series}
          onSeries=${setSeries}
          onPick=${(minute) => send('seek', { t: minute * 60 })}
          width=${400}
          height=${90}
        />
      `}
    </div>
  `;
}
