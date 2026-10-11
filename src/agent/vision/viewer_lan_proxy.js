// Adapted from Cortico's MIT-licensed viewer LAN proxy; see modern/LICENSE.
import http from 'node:http';
import net from 'node:net';

export async function startViewerLanProxy({ address, prefixLength = 24, port, backendPort }) {
    if (net.isIP(address) !== 4 || !Number.isInteger(prefixLength) || prefixLength < 8 || prefixLength > 30
        || !Number.isInteger(port) || !Number.isInteger(backendPort)) throw new Error('Invalid viewer LAN configuration');
    const backendHost = `127.0.0.1:${backendPort}`;
    const backendOrigin = `http://${backendHost}`;
    const ipv4 = ip => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
    const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
    const subnet = ipv4(address) & mask;
    const sockets = new Set();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
    const host = () => `${address}:${port}`;
    const origin = () => `http://${host()}`;
    function allowed(req, upgrade = false) {
        const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
        if (net.isIP(remote) !== 4 || (ipv4(remote) & mask) !== subnet || req.headers.host !== host()
            || (req.headers.origin && req.headers.origin !== origin()) || !req.url?.startsWith('/')
            || req.url.startsWith('//')) return false;
        let pathname;
        try { pathname = decodeURIComponent(new URL(req.url, origin()).pathname); } catch { return false; }
        if (pathname === '/capture-lease' || pathname.startsWith('/capture-lease/')) return false;
        const socketPath = pathname === '/socket.io/' || pathname === '/third/socket.io/';
        return upgrade ? req.method === 'GET' && socketPath
            : req.method === 'GET' || (req.method === 'POST' && socketPath);
    }
    function headers(req) {
        const result = { ...req.headers, host: backendHost };
        if (result.origin) result.origin = backendOrigin;
        for (const key of Object.keys(result)) {
            if (key.startsWith('x-mc-viewer-') || key.startsWith('x-forwarded-') || key === 'forwarded') delete result[key];
        }
        return result;
    }
    const reject = (socket, status = '403 Forbidden') =>
        socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const server = http.createServer((req, res) => {
        if (!allowed(req)) { res.writeHead(403); res.end(); return; }
        const upstream = http.request({ hostname: '127.0.0.1', port: backendPort,
            path: req.url, method: req.method, headers: headers(req), agent }, reply => {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.on('error', () => res.destroy());
            reply.pipe(res);
        });
        upstream.setTimeout(30_000, () => upstream.destroy(new Error('Viewer upstream timeout')));
        upstream.on('error', () => {
            if (!res.headersSent) res.writeHead(502);
            res.end('Viewer is not available');
        });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
        req.pipe(upstream);
    });
    server.on('upgrade', (req, socket, head) => {
        if (!allowed(req, true)) { reject(socket); return; }
        const upstream = http.request({ hostname: '127.0.0.1', port: backendPort,
            path: req.url, method: 'GET', headers: headers(req), agent: false });
        upstream.setTimeout(15_000, () => upstream.destroy(new Error('Viewer upgrade timeout')));
        socket.on('error', () => upstream.destroy());
        socket.on('close', () => upstream.destroy());
        upstream.on('error', () => { if (!socket.destroyed) reject(socket, '502 Bad Gateway'); });
        upstream.on('response', reply => { reply.resume(); reject(socket, '502 Bad Gateway'); });
        upstream.on('upgrade', (reply, peer, peerHead) => {
            peer.setTimeout(0); socket.setTimeout(0);
            const responseHeaders = Object.entries(reply.headers).flatMap(([key, value]) =>
                (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)).join('');
            socket.write(`HTTP/1.1 101 Switching Protocols\r\n${responseHeaders}\r\n`);
            if (peerHead.length) socket.write(peerHead);
            if (head.length) peer.write(head);
            peer.on('error', () => socket.destroy()); peer.on('close', () => socket.destroy());
            socket.on('close', () => peer.destroy());
            socket.pipe(peer).pipe(socket);
        });
        upstream.end();
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    server.on('clientError', (_error, socket) => reject(socket, '400 Bad Request'));
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, address, () => { server.off('error', reject); port = server.address().port; resolve(); });
    });
    return { url: origin(), async close() {
        for (const socket of sockets) socket.destroy();
        agent.destroy();
        await new Promise(resolve => server.close(resolve));
    } };
}
