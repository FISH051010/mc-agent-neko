// app.js — 应用入口：hash 路由 + 视图装载 + 主题 + 全局轮询。
//
// 视图模块契约：
//   export const meta = { title, desc }
//   export async function mount(root)  -> 可选返回 dispose()（离开页面时清定时器/订阅）
// 任何视图加载失败都在这里兜住，绝不白屏。

import { tryGet, toast } from './lib/api.js';
import { getSocket } from './lib/socket.js';
import { boot, status, connected, agents, botState, botName } from './lib/store.js';
import { html, render, icons, qs } from './lib/dom.js';

// ── 路由表 ──────────────────────────────────────────────────────────────────
const ROUTES = [
    { id: 'overview', label: '概览',     load: () => import('./views/overview.js') },
    { id: 'models',   label: 'AI 配置',  load: () => import('./views/models.js') },
    { id: 'bot',      label: 'Bot 设定', load: () => import('./views/bot.js') },
    { id: 'game',     label: '游戏连接', load: () => import('./views/game.js') },
    { id: 'advanced', label: '高级',     load: () => import('./views/advanced.js') },
];
const DEFAULT_ROUTE = 'overview';

const viewRoot = qs('#view');
const navRoot = qs('#nav');
let disposeCurrent = null;
let currentId = null;

// ── 主题 ────────────────────────────────────────────────────────────────────
const THEME_KEY = 'mcpanel.theme';
const THEME_ORDER = ['auto', 'dark', 'light'];
const THEME_LABEL = { auto: '跟随系统', dark: '暗色', light: '亮色' };

function readTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; }
}
function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode === 'auto' ? '' : mode);
    const btn = qs('#themeBtn');
    if (btn) {
        btn.innerHTML = String(mode === 'light' ? icons.sun : mode === 'dark' ? icons.moon : icons.auto);
        btn.title = `主题：${THEME_LABEL[mode]}（点击切换）`;
    }
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* 隐私模式下写不了，忽略 */ }
}
function initTheme() {
    applyTheme(readTheme());
    qs('#themeBtn')?.addEventListener('click', () => {
        const next = THEME_ORDER[(THEME_ORDER.indexOf(readTheme()) + 1) % THEME_ORDER.length];
        applyTheme(next);
        toast(`主题已切换为「${THEME_LABEL[next]}」`, 'info', 1800);
    });
}

// ── 导航 ────────────────────────────────────────────────────────────────────
function buildNav() {
    render(navRoot, html`${ROUTES.map(r => html`<a class="tab" href="#/${r.id}" data-route="${r.id}">${r.label}</a>`)}`);
}
function markNav(id) {
    for (const a of navRoot.querySelectorAll('.tab')) {
        a.classList.toggle('active', a.dataset.route === id);
    }
}

// ── 引导条 ──────────────────────────────────────────────────────────────────
function refreshBanner() {
    const el = qs('#banner');
    if (!el) return;
    const b = boot.value;
    const s = status.value;
    const keysReady = (s && typeof s.keysReady === 'boolean') ? s.keysReady : b?.keysReady;

    if (keysReady === false) {
        el.className = 'banner';
        render(el, html`
            <span class="banner-icon">${icons.alert}</span>
            <span class="grow">还没有配置 AI 密钥，Bot 暂时无法开动。选一家供应商填上密钥就能开始玩了。</span>
            <a class="btn sm primary" href="#/models">去 AI 配置</a>`);
    } else if (b?.firstRun) {
        el.className = 'banner info';
        render(el, html`
            <span class="banner-icon">${icons.info}</span>
            <span class="grow">欢迎！先去「Bot 设定」给它起个名字、挑张皮肤，再到「游戏连接」填上你的世界地址。</span>
            <a class="btn sm" href="#/bot">开始设置</a>`);
    } else {
        el.className = 'banner hidden';
        el.replaceChildren();
    }
}

// ── 连接指示灯 ──────────────────────────────────────────────────────────────
function refreshConn() {
    const dot = qs('#connDot');
    const text = qs('#connText');
    if (!dot || !text) return;
    if (connected.value) {
        dot.className = 'dot ok live';
        text.textContent = '已连接';
    } else {
        dot.className = 'dot danger';
        text.textContent = '未连接';
    }
    const sub = qs('#brandSub');
    if (sub) {
        const name = botName();
        sub.textContent = name ? `${name} 的控制面板` : '控制面板';
    }
}

// ── 路由切换 ────────────────────────────────────────────────────────────────
function routeId() {
    const raw2 = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return ROUTES.some(r => r.id === raw2) ? raw2 : DEFAULT_ROUTE;
}

async function navigate() {
    const id = routeId();
    if (id === currentId) return;
    currentId = id;
    markNav(id);

    if (typeof disposeCurrent === 'function') {
        try { disposeCurrent(); } catch (err) { console.error('[app] 视图清理出错', err); }
    }
    disposeCurrent = null;

    render(viewRoot, html`<div class="card">
        <div class="skeleton" style="height:18px;width:32%"></div>
        <div class="skeleton mt-3" style="height:14px;width:58%"></div>
        <div class="skeleton mt-3" style="height:14px;width:42%"></div>
    </div>`);

    const route = ROUTES.find(r => r.id === id);
    try {
        const mod = await route.load();
        if (currentId !== id) return;           // 用户在加载期间又切走了
        viewRoot.replaceChildren();
        const dispose = await mod.mount(viewRoot);
        if (currentId !== id) { try { dispose?.(); } catch { /* 忽略 */ } return; }
        disposeCurrent = typeof dispose === 'function' ? dispose : null;
        viewRoot.scrollIntoView({ block: 'start' });
    } catch (err) {
        console.error('[app] 视图加载失败', err);
        render(viewRoot, html`
            <div class="card">
                <div class="card-head"><span class="badge danger">出错了</span></div>
                <div class="card-title">「${route.label}」这一页没能打开</div>
                <p class="field-help mt-2">${err?.message || '未知错误'}</p>
                <div class="card-foot">
                    <button class="btn" onclick="location.reload()">刷新重试</button>
                    <a class="btn ghost" href="#/overview">回到概览</a>
                </div>
            </div>`);
    }
}

// ── 全局数据刷新 ────────────────────────────────────────────────────────────
// /api/status 是 socket 之外的第二条腿：socket 断了或后端还没接上时，
// 页面仍然能拿到「是否在跑 / 密钥是否就绪」。
let pollTimer = null;
async function refreshStatus() {
    const { data } = await tryGet('/api/status', null);
    if (data) {
        status.value = data;
        // 后端 /api/status 也会带 state；socket 没推的时候用它兜底
        if (data.state && !botState.value) botState.value = data.state;
    }
    refreshBanner();
}

async function loadBootstrap() {
    const { data } = await tryGet('/api/bootstrap', null);
    if (data) boot.value = data;
    refreshBanner();
    refreshConn();
}

// ── 启动 ────────────────────────────────────────────────────────────────────
function start() {
    initTheme();
    buildNav();

    connected.subscribe(refreshConn);
    agents.subscribe(refreshConn, false);
    boot.subscribe(refreshBanner, false);
    status.subscribe(refreshBanner, false);

    getSocket();          // 建连（内部会自动 listen-to-agents）
    loadBootstrap();
    refreshStatus();
    pollTimer = setInterval(refreshStatus, 4000);

    window.addEventListener('hashchange', navigate);
    if (!location.hash) location.replace(`#/${DEFAULT_ROUTE}`);
    navigate();

    // 页面隐藏时停掉轮询，别在后台白烧 CPU
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearInterval(pollTimer); pollTimer = null; }
        else if (!pollTimer) { refreshStatus(); pollTimer = setInterval(refreshStatus, 4000); }
    });
}

// 顶层兜底：任何未捕获异常都提示用户，而不是静默白屏
window.addEventListener('error', (e) => console.error('[app] 未捕获错误', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[app] 未处理的 Promise 拒绝', e.reason));

start();

export { ROUTES };
