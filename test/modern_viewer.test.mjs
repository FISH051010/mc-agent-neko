import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';
import { Vec3 } from 'vec3';
import settings from '../src/agent/settings.js';
import { addBrowserViewer } from '../src/agent/vision/browser_viewer.js';
import { startModernViewer } from '../src/agent/vision/modern/host.mjs';

const require = createRequire(import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
function fakeBot() {
    return Object.assign(new EventEmitter(), {
        username: 'viewer_fixture', version: '1.20.6',
        registry: require('minecraft-data')('1.20.6'),
        _client: Object.assign(new EventEmitter(), { state: 'play' }),
        world: Object.assign(new EventEmitter(), { getColumn: () => null, getColumnAt: () => null }),
        entity: { id: 1, name: 'player', position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0),
            yaw: 0, pitch: 0, metadata: [], equipment: [], effects: {}, onGround: true },
        game: { dimension: 'overworld', minY: -64, height: 384 },
        inventory: Object.assign(new EventEmitter(), { slots: Array(46).fill(null), hotbarStart: 36 }),
        time: { timeOfDay: 0, age: 0 }, entities: {}, players: {}, experience: {},
        health: 20, food: 20, oxygenLevel: 20, quickBarSlot: 0,
        blockAt: () => null,
        chat() { assert.fail('watching must not send game chat'); },
    });
}
async function assets(t) {
    const temp = path.resolve(tmpdir());
    const root = await mkdtemp(path.join(temp, 'mc-modern-viewer-test-'));
    assert.equal(path.dirname(root), temp);
    t.after(() => rm(root, { recursive: true, force: true }));
    const browser = '// minimal browser fixture';
    const files = {
        'dist/modern-viewer.js': browser,
        'public/asset-source.json': JSON.stringify({ minecraftVersion: '1.20.6', clientJarSha256: 'fixture' }),
        'viewer-client.json': JSON.stringify({ minecraftVersion: '1.20.6', clientJarSha256: 'fixture',
            browserBundleSha256: sha256(browser) }),
        'public/mesher.js': '', 'public/mesherWasm.js': '', 'public/threeWorker.js': '',
        'public/blocksStates/1.20.6.json': '{}', 'public/textures/1.20.6.png': '',
        'render-assets/blockStatesModels.json': '{}', 'render-assets/blocksAtlases.json': '{}',
        'render-assets/itemsAtlases.json': '{}', 'render-assets/painting-records.json': '[]',
    };
    for (const [relative, value] of Object.entries(files)) {
        const file = path.join(root, relative);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, value);
    }
    return root;
}
async function availablePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
function connect(t, base, socketPath = '/socket.io/', busy = false) {
    const socket = io(base, { path: socketPath, transports: ['websocket'], reconnection: false,
        extraHeaders: { Origin: base } });
    t.after(() => socket.close());
    const ready = busy ? 'viewerBusy' : 'avatarState';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${ready} from ${base}${socketPath}`)), 4000);
        socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
        socket.once(ready, value => { clearTimeout(timer); resolve({ socket, value }); });
    });
}

test('host rejects invalid viewing limits and mismatched browser assets', async t => {
    for (const maxSessions of [0, 17, 1.5]) {
        await assert.rejects(startModernViewer(fakeBot(), { maxSessions }), /maxSessions/);
    }
    const root = await assets(t);
    await writeFile(path.join(root, 'dist/modern-viewer.js'), '// changed after manifest generation');
    await assert.rejects(startModernViewer(fakeBot(), { port: 3000, assetsDir: root }), /资源不完整/);
});

test('modern host streams both views over local and LAN connections and reuses slots', { timeout: 15000 }, async t => {
    const root = await assets(t);
    const port = await availablePort();
    Object.assign(settings, { render_bot_view: true, viewer_type: 'modern', viewer_port: port,
        modern_viewer_assets_dir: root, modern_viewer_max_sessions: 3,
        modern_viewer_lan_address: '127.0.0.2', modern_viewer_lan_prefix: 8 });
    const bot = fakeBot();
    await addBrowserViewer(bot);
    t.after(() => bot.viewer.close());
    const base = `http://127.0.0.1:${port}`;
    const lan = `http://127.0.0.2:${port}`;
    assert.equal(bot.viewer.info.lan_url, lan + '/');
    assert.deepEqual(bot.viewer.info.views, ['first', 'third', 'dungeon']);
    for (const route of ['/', '/third/', '/dungeon/']) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200);
        assert.doesNotMatch(await response.text(), /<iframe[^>]+corti-speech-bubble/);
    }
    const a = await connect(t, base);
    await connect(t, base, '/third/socket.io/');
    await connect(t, lan);
    assert.equal(a.value.health, 20);
    const health = async () => (await fetch(base + '/healthz')).json();
    assert.equal((await health()).viewers, 3);
    const rejected = await connect(t, base, '/socket.io/', true);
    assert.equal(rejected.value.maximum, 3);
    const message = once(a.socket, 'gameMessage');
    bot.emit('message', { toString: () => 'hello from another player' }, 'chat');
    assert.equal((await message)[0].text, 'hello from another player');
    a.socket.close();
    for (let attempt = 0; (await health()).viewers === 3 && attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    await connect(t, lan, '/third/socket.io/');
    assert.equal((await health()).viewers, 3);
    assert.equal((await fetch(lan + '/capture-lease')).status, 403);
});

test('vendored host matches its recorded source hash', async () => {
    const metadata = JSON.parse(await readFile(new URL('../src/agent/vision/modern/source.json', import.meta.url)));
    const host = await readFile(new URL('../src/agent/vision/modern/host.mjs', import.meta.url));
    assert.equal(sha256(host), metadata.bundleSha256);
});
