// Live regression probe: no game actions or model calls; closes every test socket.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000').origin;
const health = async () => {
    const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return response.json();
};
const before = await health();
assert(before.maxSessions - before.viewers >= 4, 'Need four free viewing slots for this probe');
const clients = [];
const errors = [];
async function open(path) {
    const socket = io(base, { path, transports: ['websocket'], reconnection: false,
        extraHeaders: { Origin: base } });
    const state = { path, frames: 0, chunks: 0, version: null, lastFrameAt: 0 };
    const client = { socket, state, closing: false };
    clients.push(client);
    await new Promise((resolve, reject) => {
        let ready = false;
        const timer = setTimeout(() => reject(Error('No live world data: ' + JSON.stringify(state))), 10000);
        const fail = message => {
            if (client.closing) return;
            errors.push(message);
            clearTimeout(timer);
            if (!ready) reject(Error(message));
        };
        const check = () => {
            if (!ready && state.frames >= 3 && state.chunks > 0 && state.version === before.version) {
                ready = true;
                clearTimeout(timer);
                resolve();
            }
        };
        socket.on('connect_error', error => fail(error.message));
        socket.on('viewerBusy', value => fail('viewerBusy: ' + JSON.stringify(value)));
        socket.on('disconnect', reason => fail('unexpected disconnect: ' + reason));
        socket.on('version', value => { state.version = value; check(); });
        socket.on('loadChunk', () => { state.chunks++; check(); });
        socket.on('avatarState', () => { state.frames++; state.lastFrameAt = Date.now(); check(); });
    });
    return client;
}
function close(client) { client.closing = true; client.socket.close(); }
let evidence;
try {
    const initial = [];
    for (const path of ['/socket.io/', '/third/socket.io/', '/socket.io/', '/third/socket.io/']) {
        initial.push(await open(path));
    }
    const during = await health();
    assert(during.viewers >= 4, 'Four viewers must be active together');
    await delay(20000);
    for (const client of initial) {
        assert(client.socket.connected);
        assert(client.state.frames >= 20, 'Expected continuous avatar frames');
        assert(Date.now() - client.state.lastFrameAt < 3000, 'Stream stalled');
    }
    close(initial[0]);
    await delay(300);
    const released = await health();
    const replacement = await open('/socket.io/');
    assert(replacement.socket.connected, 'A released slot must be reusable');
    assert.deepEqual(errors, []);
    evidence = { checkedAt: new Date().toISOString(), base, before, during, released,
        soakSeconds: 20, streams: initial.map(client => client.state), replacement: replacement.state };
} finally {
    for (const client of clients) close(client);
}
await delay(300);
evidence.after = await health();
console.log(JSON.stringify(evidence, null, 2));
