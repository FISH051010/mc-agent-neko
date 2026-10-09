// views/advanced.js — 高级：视觉 / 行为 / 性能开关 + 运行日志。
//
// 后端契约：
//   GET /api/flags  -> {flags:[{key,label,help,group,type,value,default,source,danger}]}
//   PUT /api/flags  body {KEY:"value",...} -> {ok, restartRequired:true}
//   GET /api/logs?since=<seq> -> {seq, lines:[{seq,t,text}]}
//
// 开关一律「先改再统一保存」：一个个即时下发会让用户被重启提示轰炸。
// 危险项（danger:true）保存前二次确认。

import { put, tryGet, toast, toastError, confirmDialog, ApiError } from '../lib/api.js';
import { html, render, onAct, icons, qs, busy } from '../lib/dom.js';

export const meta = { title: '高级', desc: '开关与日志' };

// ── 已知开关的中文说明（后端没给 label/help 时以这里为准） ──────────────────
const KNOWN = {
    NEKO_AGENT_SCREENSHOT_INTERVAL_MS: {
        group: 'vision', label: '画面刷新间隔', kind: 'interval',
        help: '每隔多久渲染一张 Bot 视角画面。数值越小越流畅，也越吃显卡。设为 0 等于关闭视觉。',
    },
    NEKO_RENDER_WIDTH:  { group: 'vision', label: '画面宽度', kind: 'res' },
    NEKO_RENDER_HEIGHT: { group: 'vision', label: '画面高度', kind: 'res' },
    NEKO_RENDER_JPEG_QUALITY: {
        group: 'vision', label: '画面清晰度', kind: 'range', min: 20, max: 95, step: 5,
        help: '越高越清楚，但传输更慢。50 在大多数情况下够用了。',
    },
    MC_FOOD_INSTINCTS: {
        group: 'behavior', label: '饿了自己找吃的', kind: 'bool',
        help: '打开后，Bot 饿了会自己中断手头的活去找食物。历史上这是它「乱逛」的主要原因，默认关闭。',
    },
    MC_HP_INSTINCTS: {
        group: 'behavior', label: '受伤了自己逃跑', kind: 'bool',
        help: '打开后，血量低时它会丢下任务先跑路。默认关闭，避免任务被反复打断。',
    },
    MC_SELF_PROPOSE: {
        group: 'behavior', label: '没事干时自己找活', kind: 'bool',
        help: '打开后，闲下来它会自己决定去挖矿、砍树等。关闭则只听你的指令。',
    },
    MC_SURVIVE_NOW: {
        group: 'behavior', label: '生存优先模式', kind: 'bool',
        help: '打开后它会把活下去放在第一位，可能会拒绝你下达的危险任务。',
    },
    MC_VIEW_DISTANCE: {
        group: 'perf', label: '视距', kind: 'select',
        options: [
            { value: 'tiny', label: '很近（最流畅）' },
            { value: 'short', label: '近' },
            { value: 'normal', label: '普通' },
            { value: 'far', label: '远（找矿更准，最吃性能）' },
        ],
        help: 'Bot 能「看到」多远的方块。调小能明显降低卡顿，但它找东西的范围也会变小。',
    },
    MC_PF_TICK_MS: {
        group: 'perf', label: '寻路计算预算', kind: 'range', min: 5, max: 50, step: 5,
        help: '每帧留给寻路计算的毫秒数。调大走得更聪明，但可能让整体变卡。默认 15。',
    },
};

const GROUPS = [
    { id: 'vision', label: '视觉', desc: 'Bot 视角画面（概览页显示的那个）' },
    { id: 'behavior', label: '行为', desc: '它在没有指令时会不会自作主张' },
    { id: 'perf', label: '性能', desc: '卡顿时先动这里' },
    { id: 'other', label: '其他', desc: '不常用的开关' },
];

const RES_PRESETS = [
    { w: '640', h: '400', label: '640×400 省资源' },
    { w: '800', h: '512', label: '800×512 推荐' },
    { w: '1024', h: '640', label: '1024×640 清晰' },
    { w: '1280', h: '800', label: '1280×800 最清晰' },
];

let flags = [];             // 后端原始列表
let flagMap = {};           // key -> flag
let edits = {};             // 待保存的改动 key -> string
let flagsAvailable = true;

const val = (key) => (edits[key] !== undefined ? edits[key] : (flagMap[key]?.value ?? flagMap[key]?.default ?? ''));
const isOn = (key) => { const v = String(val(key)); return v === '1' || v === 'true' || v === 'on'; };
const meta_ = (key) => ({ ...(KNOWN[key] || {}), ...pick(flagMap[key]) });
function pick(f) {
    if (!f) return {};
    const o = {};
    if (f.label) o.label = f.label;
    if (f.help) o.help = f.help;
    if (f.group) o.groupFromBackend = f.group;
    if (f.danger) o.danger = true;
    if (Array.isArray(f.options) && f.options.length) o.backendOptions = f.options;
    return o;
}

function groupOf(key) {
    const k = KNOWN[key];
    if (k) return k.group;
    const g = flagMap[key]?.group;
    if (g && GROUPS.some(x => x.id === g)) return g;
    return 'other';
}

// ── 控件 ────────────────────────────────────────────────────────────────────
function boolRow(key) {
    const m = meta_(key);
    return html`
    <div class="field">
        <label class="switch">
            <input type="checkbox" data-act="bool" data-key="${key}" ${isOn(key) ? 'checked' : ''}>
            <span class="track"></span>
            <span class="switch-text">
                <span class="field-label" style="margin:0">${m.label || key}
                    ${m.danger ? html`<span class="badge danger">谨慎</span>` : ''}</span>
                <span class="field-help">${m.help || ''}</span>
            </span>
        </label>
    </div>`;
}

function rangeRow(key, { min, max, step, unit = '' }) {
    const m = meta_(key);
    return html`
    <div class="field">
        <div class="field-label">${m.label || key}</div>
        <div class="slider-row">
            <input class="slider" type="range" data-act="range" data-key="${key}"
                   min="${min}" max="${max}" step="${step}" value="${Number(val(key)) || min}">
            <span class="slider-val" data-out="${key}">${val(key)}${unit}</span>
        </div>
        <div class="field-help">${m.help || ''}</div>
    </div>`;
}

function selectRow(key) {
    const m = meta_(key);
    const opts = m.options || (m.backendOptions || []).map(o => ({ value: o, label: o }));
    return html`
    <div class="field">
        <label class="field-label" for="fl-${key}">${m.label || key}</label>
        <select class="select" id="fl-${key}" data-act="select" data-key="${key}">
            ${opts.map(o => html`<option value="${o.value}" ${String(val(key)) === String(o.value) ? 'selected' : ''}>${o.label}</option>`)}
        </select>
        <div class="field-help">${m.help || ''}</div>
    </div>`;
}

function textRow(key) {
    const m = meta_(key);
    return html`
    <div class="field">
        <label class="field-label" for="fl-${key}">${m.label || key}</label>
        <input class="input" id="fl-${key}" type="text" data-act="text" data-key="${key}" value="${val(key)}">
        <div class="field-help">${m.help || html`<span class="mono">${key}</span>`}</div>
    </div>`;
}

function visionCard() {
    const intervalKey = 'NEKO_AGENT_SCREENSHOT_INTERVAL_MS';
    if (!flagMap[intervalKey]) return '';
    const ms = Number(val(intervalKey)) || 0;
    const on = ms > 0;
    const w = val('NEKO_RENDER_WIDTH');
    const h = val('NEKO_RENDER_HEIGHT');
    const preset = RES_PRESETS.find(p => p.w === String(w) && p.h === String(h));
    return html`
    <div class="card">
        <div class="field">
            <label class="switch">
                <input type="checkbox" data-act="vision-on" ${on ? 'checked' : ''}>
                <span class="track"></span>
                <span class="switch-text">
                    <span class="field-label" style="margin:0">开启 Bot 视觉</span>
                    <span class="field-help">关掉后概览页就没有画面了，Bot 也失去「看」的能力，但会省不少显卡资源。</span>
                </span>
            </label>
        </div>

        <div class="${on ? '' : 'hidden'}" id="visionBody">
            <hr class="divider">
            <div class="field">
                <div class="field-label">画面刷新间隔</div>
                <div class="slider-row">
                    <input class="slider" type="range" data-act="range" data-key="${intervalKey}"
                           min="200" max="5000" step="100" value="${on ? ms : 1000}">
                    <span class="slider-val" data-out="${intervalKey}">${on ? ms : 1000} 毫秒</span>
                </div>
                <div class="field-help">${KNOWN[intervalKey].help}</div>
            </div>

            ${flagMap.NEKO_RENDER_WIDTH ? html`
            <div class="field">
                <label class="field-label" for="resSel">画面分辨率</label>
                <select class="select" id="resSel" data-act="res">
                    ${RES_PRESETS.map(p => html`<option value="${p.w}x${p.h}" ${preset === p ? 'selected' : ''}>${p.label}</option>`)}
                    ${preset ? '' : html`<option value="${w}x${h}" selected>自定义 ${w}×${h}</option>`}
                </select>
                <div class="field-help">分辨率越高越清楚，渲染也越慢。</div>
            </div>` : ''}

            ${flagMap.NEKO_RENDER_JPEG_QUALITY ? rangeRow('NEKO_RENDER_JPEG_QUALITY', { min: 20, max: 95, step: 5 }) : ''}
        </div>
    </div>`;
}

function genericCard(groupId) {
    const keys = Object.keys(flagMap).filter(k => groupOf(k) === groupId);
    if (!keys.length) return '';
    return html`
    <div class="card">
        ${keys.map(key => {
            const m = meta_(key);
            const kind = m.kind || guessKind(key);
            if (kind === 'bool') return boolRow(key);
            if (kind === 'select') return selectRow(key);
            if (kind === 'range') return rangeRow(key, { min: m.min ?? 0, max: m.max ?? 100, step: m.step ?? 1 });
            return textRow(key);
        })}
    </div>`;
}

function guessKind(key) {
    const f = flagMap[key];
    const t = String(f?.type || '').toLowerCase();
    if (t === 'boolean' || t === 'bool') return 'bool';
    if (t === 'select' || (Array.isArray(f?.options) && f.options.length)) return 'select';
    if (t === 'number' || t === 'range') return 'range';
    const v = String(f?.value ?? f?.default ?? '');
    if (v === '0' || v === '1') return 'bool';
    return 'text';
}

// ── 页面 ────────────────────────────────────────────────────────────────────
function page() {
    const pendingCount = Object.keys(edits).length;
    return html`
    <div class="page-head">
        <div class="page-title">高级</div>
        <div class="page-desc">不确定的开关就别动。改坏了把它调回默认值即可，面板会自动跟随随包默认。</div>
    </div>

    ${flagsAvailable ? html`
        <div class="section">
            <div class="section-title">视觉 <span class="hint">${GROUPS[0].desc}</span></div>
            ${visionCard() || genericCard('vision') || html`<div class="card"><div class="empty">没有可调的视觉开关</div></div>`}
        </div>

        <div class="section">
            <div class="section-title">行为 <span class="hint">${GROUPS[1].desc}</span></div>
            ${genericCard('behavior') || html`<div class="card"><div class="empty">没有可调的行为开关</div></div>`}
        </div>

        <div class="section">
            <div class="section-title">性能 <span class="hint">${GROUPS[2].desc}</span></div>
            ${genericCard('perf') || html`<div class="card"><div class="empty">没有可调的性能开关</div></div>`}
        </div>

        ${Object.keys(flagMap).some(k => groupOf(k) === 'other') ? html`
        <div class="section">
            <div class="section-title">其他 <span class="hint">${GROUPS[3].desc}</span></div>
            ${genericCard('other')}
        </div>` : ''}

        <div class="section">
            <div class="row wrap">
                <button class="btn primary" data-act="apply" ${pendingCount ? '' : 'disabled'}>
                    ${icons.check} 保存改动${pendingCount ? `（${pendingCount} 项）` : ''}
                </button>
                <button class="btn ghost" data-act="discard" ${pendingCount ? '' : 'disabled'}>放弃改动</button>
                <span class="small muted">这些开关都需要重启 Bot 才生效。</span>
            </div>
        </div>
    ` : html`
        <div class="card">
            <div class="row"><span class="badge warn">暂不可用</span></div>
            <p class="field-help mt-3">开关配置的后端接口还没准备好。</p>
        </div>`}

    <div class="section">
        <div class="section-title">运行日志 <span class="hint">出问题时把这里的内容发给开发者</span></div>
        <div class="card">
            <div class="log-toolbar">
                <button class="btn sm" data-act="log-pause">暂停</button>
                <button class="btn sm ghost" data-act="log-clear">清屏</button>
                <label class="switch" title="新日志到达时自动滚到底部">
                    <input type="checkbox" id="logFollow" checked>
                    <span class="track"></span>
                    <span class="small">自动滚动</span>
                </label>
                <input class="input" id="logFilter" type="text" placeholder="过滤关键字…" spellcheck="false">
            </div>
            <div class="log-view mono" id="logView"><span class="muted">正在读取日志…</span></div>
        </div>
    </div>`;
}

// ── 日志 ────────────────────────────────────────────────────────────────────
function startLogs(root) {
    const view = qs('#logView', root);
    const filterInput = qs('#logFilter', root);
    const followBox = qs('#logFollow', root);
    if (!view) return () => {};

    let alive = true;
    let paused = false;
    let since = 0;
    let lines = [];
    let timer = null;
    let missing = false;
    let firstDone = false;

    const paint = () => {
        const kw = (filterInput?.value || '').trim().toLowerCase();
        const shown = kw ? lines.filter(l => l.text.toLowerCase().includes(kw)) : lines;
        if (!shown.length) {
            view.innerHTML = `<span class="muted">${missing ? '日志接口还没准备好' : kw ? '没有匹配的日志' : '暂时没有日志'}</span>`;
            return;
        }
        const follow = followBox?.checked && (view.scrollHeight - view.scrollTop - view.clientHeight < 60);
        view.replaceChildren(...shown.slice(-800).map(l => {
            const span = document.createElement('span');
            const low = l.text.toLowerCase();
            span.className = 'log-line' + (low.includes('error') || low.includes('失败') ? ' err'
                : low.includes('warn') || low.includes('警告') ? ' warn' : '');
            span.textContent = l.text;
            return span;
        }));
        if (follow || followBox?.checked) view.scrollTop = view.scrollHeight;
    };

    const tick = async () => {
        if (!alive) return;
        if (!paused) {
            const res = await tryGet(`/api/logs?since=${since}`, null);
            if (res.data) {
                missing = false;
                if (typeof res.data.seq === 'number') since = res.data.seq;
                const incoming = Array.isArray(res.data.lines) ? res.data.lines : [];
                if (incoming.length) {
                    lines = lines.concat(incoming.map(l => ({
                        seq: l.seq, t: l.t, text: String(l.text ?? ''),
                    })));
                    if (lines.length > 2000) lines = lines.slice(-2000);
                }
                // 第一次拿到响应就必须重绘一次：日志为空时也要把「正在读取…」
                // 换成「暂时没有日志」，否则占位文字会一直挂在那里骗人。
                if (incoming.length || !firstDone) { firstDone = true; paint(); }
            } else if (res.error instanceof ApiError && res.error.missing) {
                missing = true;
                paint();
                timer = setTimeout(tick, 15000);   // 接口没实现就别拼命打
                return;
            }
        }
        timer = setTimeout(tick, 1500);
    };

    filterInput?.addEventListener('input', paint);
    tick();

    return {
        stop() { alive = false; clearTimeout(timer); },
        togglePause(btn) {
            paused = !paused;
            btn.textContent = paused ? '继续' : '暂停';
            btn.classList.toggle('primary', paused);
        },
        clear() { lines = []; paint(); },
    };
}

// ── 数据 / 保存 ─────────────────────────────────────────────────────────────
async function loadFlags() {
    const res = await tryGet('/api/flags', null);
    if (res.data && Array.isArray(res.data.flags)) {
        flagsAvailable = true;
        flags = res.data.flags;
        flagMap = Object.fromEntries(flags.map(f => [f.key, f]));
    } else {
        flagsAvailable = false;
        flags = [];
        flagMap = {};
    }
    edits = {};
}

async function apply(root, btn, rerender) {
    const dangerKeys = Object.keys(edits).filter(k => flagMap[k]?.danger);
    if (dangerKeys.length) {
        const names = dangerKeys.map(k => meta_(k).label || k).join('、');
        const yes = await confirmDialog({
            title: '这几项改动有风险',
            body: `你正在修改：${names}。改错可能让 Bot 行为异常。确定要保存吗？`,
            okText: '我确定',
        });
        if (!yes) return;
    }
    const done = busy(btn);
    try {
        await put('/api/flags', { ...edits });
        toast('已保存。重启 Bot 后生效。', 'ok');
        await loadFlags();
        rerender();
    } catch (err) { toastError(err, '保存失败'); }
    finally { done(); }
}

// ── 装载 ────────────────────────────────────────────────────────────────────
export async function mount(root) {
    await loadFlags();

    let logs = null;
    const paint = () => {
        const scrollY = window.scrollY;
        render(root, page());
        logs?.stop?.();
        logs = startLogs(root);
        window.scrollTo(0, scrollY);
    };
    paint();

    const offAct = onAct(root, (act, elm) => {
        if (act === 'apply') apply(root, elm, paint);
        else if (act === 'discard') { edits = {}; paint(); }
        else if (act === 'log-pause') logs?.togglePause?.(elm);
        else if (act === 'log-clear') logs?.clear?.();
    });

    // 表单类交互（change/input）单独委托，避免每次重绘都重新绑一堆
    const onChange = (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const act = t.dataset.act;
        const key = t.dataset.key;
        if (act === 'bool' && key) { edits[key] = t.checked ? '1' : '0'; refreshApplyBtn(root); }
        else if (act === 'select' && key) { edits[key] = t.value; refreshApplyBtn(root); }
        else if (act === 'text' && key) { edits[key] = t.value; refreshApplyBtn(root); }
        else if (act === 'range' && key) {
            edits[key] = String(t.value);
            const out = root.querySelector(`[data-out="${key}"]`);
            if (out) out.textContent = key.endsWith('_MS') ? `${t.value} 毫秒` : t.value;
            refreshApplyBtn(root);
        } else if (act === 'res') {
            const [w, h] = String(t.value).split('x');
            edits.NEKO_RENDER_WIDTH = w;
            edits.NEKO_RENDER_HEIGHT = h;
            refreshApplyBtn(root);
        } else if (act === 'vision-on') {
            const body = qs('#visionBody', root);
            if (t.checked) {
                const slider = root.querySelector('[data-key="NEKO_AGENT_SCREENSHOT_INTERVAL_MS"]');
                edits.NEKO_AGENT_SCREENSHOT_INTERVAL_MS = String(slider?.value || 1000);
                body?.classList.remove('hidden');
            } else {
                edits.NEKO_AGENT_SCREENSHOT_INTERVAL_MS = '0';   // <=0 就不初始化摄像机
                body?.classList.add('hidden');
            }
            refreshApplyBtn(root);
        }
    };
    root.addEventListener('change', onChange);
    root.addEventListener('input', onChange);

    return () => {
        offAct();
        logs?.stop?.();
        root.removeEventListener('change', onChange);
        root.removeEventListener('input', onChange);
    };
}

function refreshApplyBtn(root) {
    const n = Object.keys(edits).length;
    const btn = root.querySelector('[data-act="apply"]');
    const dis = root.querySelector('[data-act="discard"]');
    if (btn) {
        btn.disabled = n === 0;
        btn.innerHTML = `${icons.check} 保存改动${n ? `（${n} 项）` : ''}`;
    }
    if (dis) dis.disabled = n === 0;
}

export default { meta, mount };
