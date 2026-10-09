// views/game.js — 游戏连接：Bot 去哪个世界、以什么身份进、听谁的话。
//
// 后端契约：
//   GET /api/settings -> {fields:[{key,label,help,type,options?,value,default,group,danger?}], values:{}}
//   PUT /api/settings  body {key:value,...} -> {ok, restartRequired}
//
// ★ 降级：/api/settings 没就绪时退回读静态的 settings_spec.json（express.static 一直在供），
//   这样至少能看到当前默认值和说明，只是存不了 —— 比白屏强得多。
// ★ auth 这类有 options 的字段必须渲染成 select：老面板忽略了 spec 里的 options 用文本框，
//   用户能填出非法值，然后 bot 起不来还看不出原因。

import { put, tryGet, toast, toastError } from '../lib/api.js';
import { html, render, onAct, icons, qs, busy } from '../lib/dom.js';

export const meta = { title: '游戏连接', desc: 'Bot 连到哪个世界' };

// 本页负责的字段（顺序即展示顺序）。中文文案以这里为准，后端只提供取值。
const FIELDS = [
    {
        key: 'host', label: '服务器地址', kind: 'text',
        placeholder: 'localhost',
        help: '和你在 Minecraft 里「添加服务器」时填的一样。自己电脑上开的局域网世界填 localhost。',
    },
    {
        key: 'port', label: '端口', kind: 'number',
        placeholder: '25565',
        help: '开局域网世界时，游戏聊天栏会显示「本地游戏已在端口 xxxxx 上发布」，把那个数字填进来。填 -1 表示自动探测。',
    },
    {
        key: 'minecraft_version', label: '游戏版本', kind: 'version',
        help: '一般保持「自动检测」即可。只有连不上并提示版本不符时才手动指定，例如 1.21.4。',
    },
    {
        key: 'auth', label: '登录方式', kind: 'select',
        options: [
            { value: 'offline', label: '离线模式（局域网 / 离线服，最常用）' },
            { value: 'microsoft', label: '微软账号（正版联机服）' },
        ],
        help: '自己开的局域网世界选「离线模式」。连正版服务器才需要微软账号，会弹出网页让你登录。',
    },
    {
        key: 'player_username', label: '你的游戏 ID', kind: 'text',
        placeholder: '留空则自动识别',
        help: 'Bot 认谁当主人。留空的话它会自动把开局域网世界的那个玩家当主人。',
    },
    {
        key: 'chat_command_prefix', label: '指令前缀', kind: 'prefix',
        placeholder: '@neko',
        help: '在游戏聊天里以这个开头的话才会被当成给 Bot 的命令，其余闲聊它只是听着。',
    },
    {
        key: 'chat_whitelist', label: '可以指挥它的人', kind: 'chips',
        help: '填游戏 ID。留空 = 所有玩家都能指挥它。多人服务器上建议填上自己，免得别人乱使唤。',
    },
    {
        key: 'chat_ingame', label: '让它在游戏聊天里说话', kind: 'bool',
        help: '打开后它的回复会发到游戏聊天栏，所有人都看得到。关掉则只在这个面板里回你。',
    },
];

let values = {};
let backendFields = {};   // key -> 后端返回的字段描述（拿 options 兜底）
let readOnly = false;     // 走了静态 spec 降级
let whitelist = [];

// ── 渲染 ────────────────────────────────────────────────────────────────────
function fieldNode(f) {
    const v = values[f.key];
    const be = backendFields[f.key] || {};

    if (f.kind === 'select') {
        const opts = f.options || (be.options || []).map(o => ({ value: o, label: o }));
        return html`
        <div class="field">
            <label class="field-label" for="f-${f.key}">${f.label}</label>
            <select class="select" id="f-${f.key}" data-key="${f.key}">
                ${opts.map(o => html`<option value="${o.value}" ${String(v) === String(o.value) ? 'selected' : ''}>${o.label}</option>`)}
            </select>
            <div class="field-help">${f.help}</div>
        </div>`;
    }

    if (f.kind === 'version') {
        const auto = !v || v === 'auto';
        return html`
        <div class="field">
            <div class="field-label">${f.label}</div>
            <div class="segmented" id="verSeg">
                <button type="button" class="${auto ? 'on' : ''}" data-act="ver" data-val="auto">自动检测</button>
                <button type="button" class="${auto ? '' : 'on'}" data-act="ver" data-val="manual">手动指定</button>
            </div>
            <input class="input mt-2 ${auto ? 'hidden' : ''}" id="f-${f.key}" data-key="${f.key}" type="text"
                   spellcheck="false" placeholder="例如 1.21.4" value="${auto ? '' : v}">
            <div class="field-help">${f.help}</div>
        </div>`;
    }

    if (f.kind === 'prefix') {
        const empty = !String(v ?? '').trim();
        return html`
        <div class="field">
            <label class="field-label" for="f-${f.key}">${f.label}</label>
            <input class="input" id="f-${f.key}" data-key="${f.key}" type="text" spellcheck="false"
                   placeholder="${f.placeholder}" value="${v ?? ''}">
            <div class="field-help">${f.help}</div>
            <div class="field-help warn-text ${empty ? '' : 'hidden'}" id="prefixWarn">
                注意：前缀为空时，你在游戏里说的每一句话都会被当成命令。除非你清楚自己在做什么，否则建议填一个，比如 @neko。另外**不要用 / 开头** —— Minecraft 会把 / 开头的输入当成游戏内置命令拦下来，bot 根本收不到。
            </div>
        </div>`;
    }

    if (f.kind === 'bool') {
        const on = v === true || v === 'true' || v === 1 || v === '1';
        return html`
        <div class="field">
            <label class="switch">
                <input type="checkbox" data-key="${f.key}" ${on ? 'checked' : ''}>
                <span class="track"></span>
                <span class="switch-text">
                    <span class="field-label" style="margin:0">${f.label}</span>
                    <span class="field-help">${f.help}</span>
                </span>
            </label>
        </div>`;
    }

    if (f.kind === 'chips') {
        return html`
        <div class="field">
            <div class="field-label">${f.label}</div>
            <div class="chips" id="wlChips">
                ${whitelist.map(n => html`<span class="chip">${n}<button type="button" data-act="wl-del" data-val="${n}" title="移除">×</button></span>`)}
                <input type="text" id="wlInput" placeholder="${whitelist.length ? '继续添加…' : '留空 = 所有人都可以'}"
                       autocomplete="off" spellcheck="false">
            </div>
            <div class="field-help">${f.help}　输入后按回车添加。</div>
        </div>`;
    }

    return html`
    <div class="field">
        <label class="field-label" for="f-${f.key}">${f.label}</label>
        <input class="input" id="f-${f.key}" data-key="${f.key}"
               type="${f.kind === 'number' ? 'number' : 'text'}" spellcheck="false"
               placeholder="${f.placeholder || ''}" value="${v ?? ''}">
        <div class="field-help">${f.help}</div>
    </div>`;
}

function page() {
    return html`
    <div class="page-head">
        <div class="page-title">游戏连接</div>
        <div class="page-desc">告诉 Bot 去哪个世界找你，以及在游戏里怎么听你的话。</div>
    </div>

    ${readOnly ? html`
    <div class="notice warn">
        <span>${icons.alert}</span>
        <span>保存功能的后端接口还没准备好，下面显示的是当前配置，改动暂时存不下来。</span>
    </div>` : ''}

    <div class="card mt-4">
        <div class="card-head"><span class="card-title">服务器</span></div>
        ${FIELDS.slice(0, 4).map(fieldNode)}
    </div>

    <div class="section">
        <div class="section-title">在游戏里怎么听你的</div>
        <div class="card">
            ${FIELDS.slice(4).map(fieldNode)}
        </div>
    </div>

    <div class="section">
        <div class="row wrap">
            <button class="btn primary" data-act="save" ${readOnly ? 'disabled' : ''}>${icons.check} 保存设置</button>
            <span class="small muted">保存后需要重启 Bot 才会用新的连接信息。</span>
        </div>
    </div>

    <div class="section">
        <div class="notice">
            <span>${icons.info}</span>
            <span>连不上？先在游戏里打开世界 → 按 Esc → 「对局域网开放」，把聊天栏里显示的端口号填到上面。</span>
        </div>
    </div>`;
}

// ── 数据 ────────────────────────────────────────────────────────────────────
async function loadAll() {
    const res = await tryGet('/api/settings', null);
    if (res.data && (res.data.values || res.data.fields)) {
        readOnly = false;
        backendFields = {};
        for (const f of res.data.fields || []) backendFields[f.key] = f;
        values = { ...(res.data.values || {}) };
        for (const f of res.data.fields || []) {
            if (values[f.key] === undefined) values[f.key] = f.value ?? f.default;
        }
    } else {
        // 降级：静态 spec 只有默认值，看得见改不了
        readOnly = true;
        backendFields = {};
        values = {};
        const spec = await tryGet('/settings_spec.json', null);
        if (spec.data) {
            for (const [k, cfg] of Object.entries(spec.data)) {
                backendFields[k] = { key: k, options: cfg.options, type: cfg.type };
                values[k] = cfg.default;
            }
        }
    }
    const wl = values.chat_whitelist;
    whitelist = Array.isArray(wl) ? wl.slice() : (typeof wl === 'string' && wl ? wl.split(',').map(s => s.trim()).filter(Boolean) : []);
}

function collect(root) {
    const out = {};
    for (const el of root.querySelectorAll('[data-key]')) {
        const key = el.dataset.key;
        if (el.classList.contains('hidden')) continue;
        if (el.type === 'checkbox') { out[key] = el.checked; continue; }
        let v = el.value;
        if (key === 'port') {
            const n = parseInt(v, 10);
            // -1 是 spec 里约定的「自动探测」，别把它当非法值挡掉
            if (!Number.isFinite(n) || (n !== -1 && (n < 1 || n > 65535))) {
                throw new Error('端口要填 1–65535 之间的数字，或者填 -1 让它自动探测');
            }
            v = n;
        }
        out[key] = typeof v === 'string' ? v.trim() : v;
    }
    // 版本：选了「自动检测」就没有输入框，补一个 auto
    if (out.minecraft_version === undefined) out.minecraft_version = 'auto';
    out.chat_whitelist = whitelist;
    return out;
}

async function save(root, btn) {
    const done = busy(btn);
    try {
        const body = collect(root);
        const res = await put('/api/settings', body);
        values = { ...values, ...body };
        toast(res?.restartRequired ? '已保存，重启 Bot 后生效' : '已保存', 'ok');
    } catch (err) { toastError(err, '保存失败'); }
    finally { done(); }
}

// ── 装载 ────────────────────────────────────────────────────────────────────
export async function mount(root) {
    await loadAll();

    const paint = () => {
        render(root, page());
        wireInline(root, paint);
    };
    paint();

    return onAct(root, (act, elm) => {
        if (act === 'save') save(root, elm);
        else if (act === 'ver') {
            const manual = elm.dataset.val === 'manual';
            for (const b of root.querySelectorAll('#verSeg button')) b.classList.toggle('on', b === elm);
            const input = qs('#f-minecraft_version', root);
            if (input) {
                input.classList.toggle('hidden', !manual);
                if (manual) input.focus();
            }
        } else if (act === 'wl-del') {
            whitelist = whitelist.filter(n => n !== elm.dataset.val);
            paint();
        }
    });
}

/** 前缀空值警告 + 白名单回车录入。每次重绘后重接。 */
function wireInline(root, rerender) {
    const prefix = qs('#f-chat_command_prefix', root);
    const warn = qs('#prefixWarn', root);
    if (prefix && warn) {
        prefix.addEventListener('input', () => {
            warn.classList.toggle('hidden', !!prefix.value.trim());
        });
    }
    const wlInput = qs('#wlInput', root);
    if (wlInput) {
        wlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const name = wlInput.value.trim();
                if (name && !whitelist.includes(name)) {
                    whitelist.push(name);
                    rerender();
                    qs('#wlInput', root)?.focus();
                } else {
                    wlInput.value = '';
                }
            } else if (e.key === 'Backspace' && !wlInput.value && whitelist.length) {
                whitelist.pop();
                rerender();
                qs('#wlInput', root)?.focus();
            }
        });
    }
}

export default { meta, mount };
