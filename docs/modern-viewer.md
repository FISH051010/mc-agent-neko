# Modern browser viewer

Watch the existing Mineflayer bot in first-person (`/`), third-person (`/third/`)
or dungeon 2.5D (`/dungeon/`) view. The picture includes inventory, survival HUD,
received chat, a minimap and the renderer's game effects. It observes the existing
bot; it does not create another Minecraft login or run another LLM.

The optional modern renderer currently requires **Node.js 22** and **Minecraft
Java 1.20.6**. The default configuration keeps visualization disabled and retains
the Prismarine viewer option. Modern viewer startup failures are logged without
preventing the game agent from initializing.

## Generate the browser resources

The frontend is [jcs130/mc-visual-console](https://github.com/jcs130/mc-visual-console),
an MIT-licensed project with portable browser source and offline resource tools.
The host adapter is included in this repository; generate browser code and
Minecraft resources from the [pinned renderer source](https://github.com/jcs130/mc-visual-console/tree/ca958cb26fed0c459e226f6bc6b97308f50203af/packages/modern-viewer/renderer-src).
Its revision, source tree and license are recorded in
[`renderer-source.json`](../src/agent/vision/modern/renderer-source.json) and
[`RENDERER_LICENSE`](../src/agent/vision/modern/RENDERER_LICENSE).
The pinned runtime source and build tools match the renderer accompanying this
host adapter. The standalone frontend needs no Cortico checkout or service.
The following commands work in PowerShell or a
POSIX shell; replace the two absolute paths with your own client JAR and output
directory. Use the same output directory throughout.

```sh
git clone https://github.com/jcs130/mc-visual-console.git mc-visual-console
git -C mc-visual-console checkout ca958cb26fed0c459e226f6bc6b97308f50203af
cd mc-visual-console/packages/modern-viewer/renderer-src
npm ci
python -m pip install -r tools/requirements.txt
python tools/export-minecraft-viewer-assets.py "/path/to/1.20.6.jar" "/path/to/viewer-assets"
node tools/build-minecraft-viewer-client.mjs . "/path/to/viewer-assets"
node tools/verify-minecraft-viewer-assets.mjs "/path/to/1.20.6.jar" "/path/to/viewer-assets"
```

Use your installed Minecraft 1.20.6 **client** JAR. The output contains
`viewer-client.json`, `dist/`, `public/` and `render-assets/`; these generated
resources are not committed here. The exporter records the JAR hash and the
builder records the browser bundle hash. The host checks that the manifests,
protocol version and generated bundle agree before accepting viewers.
Use the default generic build shown above. The frontend's
[Socket.IO contract](https://github.com/jcs130/mc-visual-console/blob/ca958cb26fed0c459e226f6bc6b97308f50203af/packages/modern-viewer/renderer-src/SOCKET_PROTOCOL.md)
documents the game state consumed by the browser; the bundled adapter supplies
that stream from the existing bot.

## Enable local viewing

In `settings.js`, or in the settings file already used by your deployment:

```js
"render_bot_view": true,
"viewer_type": "modern",
"viewer_port": 3000,
"modern_viewer_assets_dir": "/path/to/viewer-assets",
"modern_viewer_lan_address": "",
"modern_viewer_lan_prefix": 24,
"modern_viewer_max_sessions": 8,
```

On Windows, forward slashes work in absolute paths such as
`C:/minecraft/viewer-assets`. Start the agent normally and open
`http://127.0.0.1:3000/dungeon/`. Other viewpoints share the same port; each
additional agent uses the next port. The browser needs WebGL2.

Set `viewer_type` to `prismarine` to use the existing browser renderer instead.
The modern adapter loads its rendering dependencies only when enabled, and the
Prismarine option imports the browser transport without the package's headless
renderer entry point.

## Enable LAN viewing

Set `modern_viewer_lan_address` to the computer's actual LAN IPv4 address, for
example `192.168.1.20`, and set `modern_viewer_lan_prefix` to the subnet prefix
used by that network (usually `24`). Then open
`http://192.168.1.20:3000/dungeon/` from another device. Allow the chosen port in
the host firewall for your private network if required. Update the setting if
DHCP changes the computer's address.

The rendering host binds to loopback; a separate proxy binds to the chosen LAN
address and accepts clients from that subnet. It checks Host and Origin,
forwards the viewer's HTTP and Socket.IO traffic, removes forwarded/control
headers, and blocks capture-lease management from LAN clients. Viewing adds no
remote game-control endpoint. The project's existing agent-control WebSocket is
separate and its binding is unchanged by this feature.

`modern_viewer_max_sessions` is shared by all local/LAN viewing pages and all
viewpoints (default 8, integer 1–16). Each page consumes one slot; closing a page
releases it. Capture retains its separate limit of one. `/healthz` reports the
current and maximum counts. A healthy HTTP response alone does not prove that
the bot is moving or that browser rendering has succeeded.

## Optional game sound

Sound requires matching launcher resources in addition to the client JAR. From
the same renderer source directory, run:

```sh
node tools/export-minecraft-viewer-sounds.mjs "/path/to/versions/1.20.6/1.20.6.json" "/path/to/launcher/assets" "/path/to/viewer-assets"
```

The exporter reads the local launcher cache. The renderer disables numbered
sound events when the matching registry is missing. Browser interaction is
required to allow playback. Cortico speech bubbles, host speech relays and
livestream overlays are excluded from this adapter.

## Validation and maintenance

The tests need the project's npm dependencies but no Minecraft server, model,
client JAR or GPU. Their synthetic resources exercise the host and socket
transport; they do not validate browser pixels.

```sh
node --test test/browser_viewer.test.mjs test/modern_viewer.test.mjs test/viewer_lan_proxy.test.mjs
```

With a real agent online and four free viewing slots, check streaming and slot
reuse without sending game actions or model requests:

```sh
node scripts/verify-modern-viewer-sessions.mjs http://127.0.0.1:3000
node scripts/verify-modern-viewer-sessions.mjs http://192.168.1.20:3000
```

The vendored `src/agent/vision/modern/host.mjs` is bundled from MIT-licensed
Cortico sources. Its original license and the exact revision, input files and
SHA-256 are stored beside it in `LICENSE` and `source.json`. This host provenance
is separate from the frontend project's provenance. To rebuild the host, prepare
the recorded Cortico checkout:

```sh
git clone https://github.com/jcs130/Cortico.git cortico-viewer-source
git -C cortico-viewer-source checkout f0db612ce5075287330ab3e095ffa449c6e8e71c
cd cortico-viewer-source
pnpm install --frozen-lockfile
```

Then return to this repository's root and run:

```sh
node scripts/import-modern-viewer.mjs "/path/to/cortico-viewer-source"
```

Review the source revision and regenerated diff together. The importer removes
the speech/stream overlay and makes viewing slots configurable; it fails if the
expected upstream transformation points have changed. When updating either
source, check the frontend's Socket.IO contract against the host, update the
frontend pin in `renderer-source.json`, and rebuild and verify browser assets.
