# yt-mine sidebar (Firefox)

yt-mine's transcript inside YouTube's watch page, in the column the
recommendations use. It follows the video: the line being spoken is lit and
kept centred, and a seek scrolls to the new line. Click a word for the same
popup as yt-mine and the overlay, with the same ledger tints.

The extension is only a shell. The page it frames is yt-mine's own
`/{video_id}/sidebar` (`static/features/sidebar/`), so everything about words,
the ledger and cards stays in yt-mine and is shared with its other pages.

## Install

1. Get an AMO API key once: <https://addons.mozilla.org/developers/addon/api/key/>.
   Put the two values in the repo's `.env`:

   ```sh
   KOTODEX_AMO_API_KEY=user:12345:67
   KOTODEX_AMO_API_SECRET=...
   ```

2. `yt-mine/extension/sign.sh` signs it unlisted (private, not published) and
   writes the `.xpi` to `target/extension/`. Drag that into Firefox.

For a quick try without signing: `about:debugging` → This Firefox → Load
Temporary Add-on → `manifest.json`. It is gone after a restart.

yt-mine must be running (`scripts/start-all.sh start yt-mine`). The address is
`http://127.0.0.1:3000` unless changed in the extension's options.

### Local network access

Firefox blocks a public site from loading anything on this machine unless you
allow it, and the sidebar is youtube.com loading 127.0.0.1. The block covers the
whole tab, including pages the extension creates, so there is no way around it
from inside the extension. Pick one:

- **Allow YouTube once.** Firefox asks the first time the sidebar loads. Allowing
  it lets every script on youtube.com reach services on this machine, not only
  yt-mine.
- **Reclassify only yt-mine's port** (narrower). In `about:config`, set
  `network.lna.address_space.public.override` to `127.0.0.1:3000`. YouTube then
  reaches that one port and nothing else, and there is no prompt. yt-mine sends
  no CORS headers, so a YouTube script still cannot read its API.

## Keys

With the sidebar focused, YouTube's own keys stop working, so these are passed
back: Space / `k` play-pause, ← → ±5 s, `j` `l` ±10 s, `f` fullscreen.
`r` replays the current line.

## Files

| file             | what it knows                                                      |
| ---------------- | ------------------------------------------------------------------ |
| `src/youtube.js` | YouTube's DOM. The one file to fix when YouTube changes its layout |
| `src/player.js`  | the `<video>`: seek, play a range and stop at its end, report time |
| `src/panel.js`   | the column box, its collapse toggle, the "not answering" notice    |
| `src/bridge.js`  | the message channel to the framed page                             |
| `src/main.js`    | wires the four together                                            |

## Messages

`postMessage`, every message `{ ns: 'yt-mine/sidebar', type, ...fields }`. The
page's end is `static/features/sidebar/host.js`. The page only accepts messages
from `https://www.youtube.com`, and the extension only from the yt-mine origin.

YouTube → page:

| type        | fields        | when                                                      |
| ----------- | ------------- | --------------------------------------------------------- |
| `time`      | `t`, `paused` | every `timeupdate`, play, pause and seek. Not during ads |
| `jump`      | `t`           | the playhead moved by a seek; the page resumes following |
| `range-end` |               | a `play-range` stopped, finished or was interrupted      |

Page → YouTube:

| type          | fields         |                                             |
| ------------- | -------------- | ------------------------------------------- |
| `ready`       |                | the page is up; the extension sends `time` |
| `seek`        | `t`            |                                             |
| `nudge`       | `by`           | seek relative to now                        |
| `toggle-play` |                |                                             |
| `play-range`  | `start`, `end` | play one line, pause at its end             |
| `stop-range`  |                |                                             |
| `fullscreen`  |                |                                             |
