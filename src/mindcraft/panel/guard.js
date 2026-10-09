// guard.js — 控制面板的访问闸门。
//
// 面板能改 keys.json、能改 bot 配置、能启停 agent —— 权限等同于"在这台机器上执行任意
// LLM 请求 + 花用户的 API 额度"。mindserver 只 bind localhost 并不足够：
//   · DNS rebinding —— 恶意站点把自己的域名解析到 127.0.0.1，浏览器就会拿这个域名
//     向我们发请求，socket 层看到的仍然是本机地址。所以必须查 Host 头。
//   · CSRF —— 用户开着面板时访问恶意页面，页面可以 fetch 我们的 /api 写接口。
//     所以非 GET 请求必须查 Origin/Referer 同源。
//
// 四重门（写操作全过，读操作只过第一道）：
//   1. remoteAddress 必须是回环地址
//   2. Host 头必须是 localhost / 127.0.0.1 / [::1]
//   3. 若带 Origin 或 Referer，其源必须是本机
//   4. 进程级令牌：X-Panel-Token 头或 mc_panel_token cookie 与本进程令牌一致
//      —— 例外：第 3 步已经拿到**同源** Origin 的请求视为面板自己发的，放行。
//      浏览器对跨站的非 GET 请求一定会带上真实 Origin，伪造不出同源值，所以这个
//      例外不会给 CSRF 开口子；它的作用是让面板前端不必自己管令牌。

import crypto from 'crypto';

/** 本进程令牌。每次启动重新生成 —— 不落盘，进程一死就作废。 */
export const PANEL_TOKEN = crypto.randomBytes(24).toString('hex');
export const TOKEN_COOKIE = 'mc_panel_token';
export const TOKEN_HEADER = 'x-panel-token';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

/** socket 层地址是否回环。IPv4-mapped IPv6（::ffff:127.0.0.1）也要认。 */
export function isLoopbackAddress(addr) {
    if (!addr) return false;
    let a = String(addr).trim().toLowerCase();
    if (a.startsWith('::ffff:')) a = a.slice(7);
    if (a === '::1' || a === '0:0:0:0:0:0:0:1') return true;
    return a === '127.0.0.1' || a.startsWith('127.');
}

function hostnameOf(hostHeader) {
    if (!hostHeader) return '';
    let h = String(hostHeader).trim().toLowerCase();
    if (h.startsWith('[')) {                       // [::1]:8765
        const end = h.indexOf(']');
        return end > 0 ? h.slice(0, end + 1) : h;
    }
    const colon = h.indexOf(':');
    return colon >= 0 ? h.slice(0, colon) : h;
}

function originHostname(originOrReferer) {
    if (!originOrReferer) return null;
    const s = String(originOrReferer).trim();
    if (s === 'null') return null;                 // file:// 页面等，视为无来源
    try { return new URL(s).hostname.toLowerCase(); } catch { return null; }
}

/** 读操作：只查来源地址。 */
export function checkRead(req) {
    const addr = req.socket?.remoteAddress || req.connection?.remoteAddress;
    if (!isLoopbackAddress(addr)) {
        return { code: 'REMOTE_DENIED', error: '控制面板只能在本机访问。' };
    }
    return null;
}

/** 写操作：四重门。返回 null 表示放行。 */
export function checkWrite(req) {
    const readErr = checkRead(req);
    if (readErr) return readErr;

    // 2. Host 头 —— 挡 DNS rebinding
    const host = hostnameOf(req.headers?.host);
    if (!LOOPBACK_HOSTS.has(host)) {
        return { code: 'BAD_HOST', error: '请求地址不是本机，已拒绝。请用 http://localhost 打开控制面板。' };
    }

    // 3. Origin / Referer 同源
    const rawOrigin = req.headers?.origin || req.headers?.referer || '';
    const originHost = originHostname(rawOrigin);
    const hasSameOrigin = originHost !== null && LOOPBACK_HOSTS.has(originHost);
    if (originHost !== null && !hasSameOrigin) {
        return { code: 'BAD_ORIGIN', error: '这个请求不是控制面板页面发出的，已拒绝。' };
    }

    // 4. 令牌（同源浏览器请求豁免，见文件头说明）
    if (hasSameOrigin) return null;
    const token = readToken(req);
    if (token && token === PANEL_TOKEN) return null;
    return { code: 'BAD_TOKEN', error: '缺少控制面板令牌，已拒绝。请刷新控制面板页面后重试。' };
}

function readToken(req) {
    const header = req.headers?.[TOKEN_HEADER];
    if (header) return String(header).trim();
    const cookie = req.headers?.cookie;
    if (!cookie) return '';
    for (const part of String(cookie).split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === TOKEN_COOKIE) return part.slice(eq + 1).trim();
    }
    return '';
}

/** 每次 /api 响应都把令牌种进 cookie，前端不用自己管。 */
export function issueToken(res) {
    try {
        res.setHeader('Set-Cookie',
            `${TOKEN_COOKIE}=${PANEL_TOKEN}; Path=/; SameSite=Strict; Max-Age=86400`);
    } catch { /* 头已发出，忽略 */ }
}

// ── express 中间件 ───────────────────────────────────────────────────────────
export function guardRead(req, res, next) {
    const err = checkRead(req);
    if (err) return res.status(403).json({ ok: false, ...err });
    issueToken(res);
    next();
}

export function guardWrite(req, res, next) {
    const err = checkWrite(req);
    if (err) return res.status(403).json({ ok: false, ...err });
    next();
}

/** socket.io 的 allowRequest 用：握手也只放本机。 */
export function allowSocketRequest(req, callback) {
    const addr = req.socket?.remoteAddress || req.connection?.remoteAddress;
    callback(null, isLoopbackAddress(addr));
}

export default { PANEL_TOKEN, checkRead, checkWrite, guardRead, guardWrite, issueToken, isLoopbackAddress, allowSocketRequest };
