import { loadSettings, saveSettings } from '../src/settings.js';

const form = document.getElementById('form');
const server = document.getElementById('server');
const saved = document.getElementById('saved');

server.value = (await loadSettings()).server;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveSettings({ server: new URL(server.value).origin });
  saved.hidden = false;
});
