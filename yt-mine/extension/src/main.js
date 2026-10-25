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

// The side rail has no API for a panel of our own. Opening one of YouTube's
// panels gets its layout (the video shrinks, the column appears); the
// transcript is then drawn in that column over YouTube's panel.
let railButton = null;
let docked = false;
let openedFor = null;
// Set once YouTube's panel is seen open, so closing it later undocks.
let sawOpen = false;

function dock() {
  const id = youtube.videoId();
  const rail = youtube.sideRail();
  console.debug('[yt-mine] dock', { id, rail, open: youtube.railPanelOpen() });
  if (!id || !rail) return;
  openedFor = null;
  if (!youtube.railPanelOpen()) {
    openedFor = youtube.nativeRailButtons(rail)[0] ?? null;
    if (openedFor) youtube.pressRailButton(openedFor);
  }
  docked = true;
  sawOpen = false;
  youtube.watchElement()?.classList.add('yt-mine-docked');
  railButton?.classList.add('yt-mine-active');
  whenPanelContainer((container) => {
    console.debug('[yt-mine] panel container', container);
    if (!docked) return;
    panel.docked(true);
    panel.show(id, container.parentElement);
  });
}

function undock({ closeYoutubePanel }) {
  if (!docked) return;
  docked = false;
  youtube.watchElement()?.classList.remove('yt-mine-docked');
  railButton?.classList.remove('yt-mine-active');
  panel.hide();
  if (closeYoutubePanel && openedFor && youtube.railPanelOpen()) youtube.pressRailButton(openedFor);
  openedFor = null;
}

function whenPanelContainer(fn) {
  const found = youtube.railPanelContainer();
  if (found) return fn(found);
  const observer = new MutationObserver(() => {
    const c = youtube.railPanelContainer();
    if (!c) return;
    observer.disconnect();
    fn(c);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function ensureRailButton() {
  const rail = youtube.sideRail();
  if (!rail || rail.contains(railButton)) return;
  railButton = youtube.makeRailButton(rail, 'yt-mine', '字');
  railButton.classList.toggle('yt-mine-active', docked);
  railButton.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (docked) undock({ closeYoutubePanel: true });
    else dock();
  }, true);
  rail.addEventListener('click', (e) => {
    if (e.isTrusted && !railButton.contains(e.target)) undock({ closeYoutubePanel: false });
  }, true);
  rail.append(railButton);
}

new MutationObserver(() => {
  ensureRailButton();
  if (!docked) return;
  if (youtube.railPanelOpen()) sawOpen = true;
  else if (sawOpen) undock({ closeYoutubePanel: false });
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['fixed-panel-expanded'],
});

async function sync() {
  const id = youtube.videoId();
  if (!id) return panel.hide();
  await youtube.watchPageReady();
  player.attach(youtube.video());
  if (youtube.sideRail()) {
    if (docked) panel.show(id, null);
    return;
  }
  panel.show(id, youtube.mountPoint());
}

youtube.onNavigate(sync);
sync();
