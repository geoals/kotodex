import { loadSettings } from './settings.js';
import * as youtube from './youtube.js';
import { createPanel } from './panel.js';
import { createBridge } from './bridge.js';
import { createPlayer } from './player.js';

const settings = await loadSettings();
const panel = createPanel(settings, { onLoad: () => bridge.reset() });
const bridge = createBridge(panel.frame, settings.server);
const player = createPlayer({ isAd: youtube.adPlaying, seekTo: youtube.seekTo });

youtube.widenSideColumn(420);

bridge.on('ready', () => {
  panel.ready();
  player.report();
});
bridge.on('seek', ({ t }) => player.seek(t));
bridge.on('nudge', ({ by }) => player.nudge(by));
bridge.on('toggle-play', () => player.toggle());
bridge.on('play-range', ({ start, end }) => player.playRange(start, end));
bridge.on('stop-range', () => player.stopRange());
bridge.on('fullscreen', () => youtube.toggleFullscreen());

player.on('time', (t, paused) => bridge.send('time', { t, paused }));
player.on('jump', (t) => bridge.send('jump', { t }));
player.on('rangeEnd', () => bridge.send('range-end'));

async function sync() {
  const id = youtube.videoId();
  if (!id) return panel.hide();
  await youtube.watchPageReady();
  player.attach(youtube.video());
  panel.show(id, youtube.mountPoint());
}

youtube.onNavigate(sync);
sync();
