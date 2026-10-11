import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { startViewerLanProxy } from '../src/agent/vision/viewer_lan_proxy.js';

test('LAN viewer forwards rendering and both real-time views while limiting access', { timeout: 10000 }, async t => {
    const backend = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: req.url, headers: req.headers }));
    });
    const transports = ['/socket.io/', '/third/socket.io/'].map(path => {
        const server = new Server(backend, { path });
        server.on('connection', socket => socket.on('probe', ack => ack(socket.handshake.headers)));
        return server;
    });
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    const proxy = await startViewerLanProxy({ address: '127.0.0.2', prefixLength: 8, port: 0, backendPort: backend.address().port });
    t.after(async () => {
        await proxy.close();
        await Promise.all(transports.map(server => new Promise(resolve => server.close(resolve))));
    });
    const response = await fetch(`${proxy.url}/dungeon/?probe=1`, { headers: {
        Origin: proxy.url, 'X-Mc-Viewer-Control': 'forbidden', 'X-Forwarded-For': '8.8.8.8', Forwarded: 'for=8.8.8.8',
    } });
    assert.equal(response.status, 200);
    const request = await response.json();
    assert.equal(request.path, '/dungeon/?probe=1');
    assert.equal(request.headers.origin, `http://127.0.0.1:${backend.address().port}`);
    assert.equal(request.headers['x-mc-viewer-control'], undefined);
    assert.equal(request.headers['x-forwarded-for'], undefined);
    assert.equal(request.headers.forwarded, undefined);
    for (const [path, options] of [
        ['/capture-lease', {}], ['/capture-lease/x', {}], ['/%63apture-lease', {}],
        ['/', { headers: { Origin: 'http://untrusted.example' } }],
        ['/', { method: 'POST' }], ['/socket.io/', { method: 'DELETE' }],
    ]) assert.equal((await fetch(proxy.url + path, options)).status, 403, path);

    // Exercise polling and WebSocket handshakes, including the third-person path.
    for (const [path, transport] of [['/socket.io/', 'polling'], ['/third/socket.io/', 'websocket']]) {
        const client = io(proxy.url, { path, transports: [transport], reconnection: false,
            extraHeaders: { Origin: proxy.url, 'X-Mc-Viewer-Control': 'forbidden' } });
        try {
            await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
            const headers = await client.timeout(2000).emitWithAck('probe');
            assert.equal(headers.host, `127.0.0.1:${backend.address().port}`);
            assert.equal(headers.origin, `http://127.0.0.1:${backend.address().port}`);
            assert.equal(headers['x-mc-viewer-control'], undefined);
        } finally { client.close(); }
    }
});
