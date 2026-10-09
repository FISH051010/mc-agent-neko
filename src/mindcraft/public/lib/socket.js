// socket.js — socket.io 单例 + 事件总线。
//
// agent 的生命周期与状态流继续走 socket（协议不改）：
//   agents-status / state-update / bot-output / listen-to-agents / send-message
//   start-agent / stop-agent / restart-agent
//
// ★ 踩坑记录：上游 index.html 里写的是
//       io({ path: window.location.pathname + 'socket.io' })
//   这在 `/` 以外的任何路径下都会拼出错误的 path（如 `/foo/socket.io`），
//   握手直接 404。mindserver 用的是默认挂载点，直接 io() 就对了。
//
// ★ socket.io 的 /socket.io/socket.io.js 若加载失败（老版本 / 被拦），
//   window.io 不存在。这里必须优雅退化成「离线模式」，不能让整个面板炸掉，
//   REST 那条路仍然可用。

import { connected, agents, botState, chatLog } from './store.js';

let sock = null;      // null=未初始化 / false=不可用 / 对象=已连
let subscribed = false;
const pending = [];   // io 尚未连上前排队的 emit

const MAX_CHAT = 200;

export function getSocket() {
    if (sock !== null) return sock;
    if (typeof globalThis.io !== 'function') {
        console.warn('[socket] socket.io 客户端脚本未加载，面板进入「仅 REST」模式');
        sock = false;
        return false;
    }
    sock = globalThis.io();   // ★ 用默认 path，别自己拼
    wire(sock);
    return sock;
}

function wire(s) {
    s.on('connect', () => {
        connected.value = true;
        subscribed = false;
        subscribeState();
        while (pending.length) { const [ev, args] = pending.shift(); s.emit(ev, ...args); }
    });
    s.on('disconnect', () => { connected.value = false; subscribed = false; });
    s.on('connect_error', () => { connected.value = false; });

    s.on('agents-status', (list) => {
        agents.value = Array.isArray(list) ? list : [];
    });

    // states 形如 { <agentName>: full_state }。面板只管一个 bot，取第一个即可。
    s.on('state-update', (states) => {
        if (!states || typeof states !== 'object') return;
        const first = Object.values(states)[0];
        if (!first || first.error) return;
        botState.value = first;
        botState.touch();
    });

    s.on('bot-output', (agentName, message) => {
        const text = typeof message === 'string' ? message : JSON.stringify(message);
        const next = chatLog.value.concat([{ who: agentName || 'bot', text, t: Date.now() }]);
        chatLog.value = next.length > MAX_CHAT ? next.slice(-MAX_CHAT) : next;
    });
}

/** 订阅状态流（mindserver 只在收到 listen-to-agents 后才推 state-update）。 */
export function subscribeState() {
    const s = getSocket();
    if (!s || subscribed) return;
    subscribed = true;
    s.emit('listen-to-agents');
}

export function emit(event, ...args) {
    const s = getSocket();
    if (!s) return false;
    if (!s.connected) { pending.push([event, args]); return false; }
    s.emit(event, ...args);
    return true;
}

/** 监听任意事件，返回取消函数。 */
export function onSocket(event, handler) {
    const s = getSocket();
    if (!s) return () => {};
    s.on(event, handler);
    return () => s.off(event, handler);
}

/** 面板自身发起的聊天（走 ADMIN 身份，与老面板一致）。 */
export function sendChat(agentName, message) {
    return emit('send-message', agentName, { from: 'ADMIN', message });
}

export default { getSocket, emit, onSocket, subscribeState, sendChat };
