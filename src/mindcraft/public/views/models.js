// views/models.js — AI 配置页：选供应商 → 填密钥 → 测连接 → 选模型 → 定思考档位。
//
// 后端契约：
//   GET  /api/providers            {providers:[...], configured:{key:{hasKey,masked,base_url}}}
//   PUT  /api/providers/:key       {api_key?, base_url?}   api_key === "__KEEP__" 表示保留原值
//   POST /api/providers/:key/test  {api_key?, model?} -> {ok, code, message, models?}
//   GET  /api/providers/:key/models -> {models:[...]}
//   GET/PUT /api/bot               {provider, model, thinking, ...}

import { put, post, tryGet, toast, toastError } from '../lib/api.js';
import { html, render, onAct, icons, qs, busy } from '../lib/dom.js';

export const meta = { title: 'AI 配置', desc: '给 Bot 接上大脑' };

const KEEP = '__KEEP__';
const REGIONS = [
    { id: 'cn', label: '国内直连', hint: '不需要梯子，注册即用' },
    { id: 'intl', label: '境外服务', hint: '需要能访问境外网络' },
    { id: 'local', label: '本机运行', hint: '在你自己电脑上跑模型，不花钱也不联网' },
];
const THINK_OPTIONS = [
    { id: 'off', label: '关闭', help: '推荐。游戏 Bot 要的是快速反应，思考链还可能把动作指令搅坏。' },
    { id: 'low', label: '低', help: '给一点点思考时间，复杂任务上略聪明，但会变慢。' },
    { id: 'auto', label: '自动', help: '不做干预，随模型自己的默认行为。' },
];

let catalog = [];       // /api/providers 的 providers
let configured = {};    // /api/providers 的 configured
let botCfg = {};        // /api/bot
let openKey = null;     // 当前展开的供应商
let modelCache = {};    // key -> string[]（测试连接/拉列表拿到的真实模型）

const byKey = (k) => catalog.find(p => p.key === k) || null;

// ── 顶部：当前正在用什么 ────────────────────────────────────────────────────
function currentCard() {
    const p = byKey(botCfg.provider);
    const ready = !!configured[botCfg.provider]?.hasKey || p?.needs_key === false;
    return html`
    <div class="card">
        <div class="row wrap between">
            <div>
                <div class="card-sub">Bot 当前使用的大脑</div>
                <div class="page-title" style="font-size:var(--fs-xl)">
                    ${p ? p.label : (botCfg.provider || '尚未选择')}
                </div>
                <div class="small muted mt-2">
                    模型：<span class="mono">${botCfg.model || '未设置'}</span>
                    ${botCfg.thinking ? html` · 思考：${THINK_OPTIONS.find(t => t.id === botCfg.thinking)?.label || botCfg.thinking}` : ''}
                </div>
            </div>
            <span class="badge ${ready ? 'ok' : 'warn'}">${ready ? '已就绪' : '还没配密钥'}</span>
        </div>
    </div>`;
}

// ── 供应商卡片 ──────────────────────────────────────────────────────────────
function providerCard(p) {
    const c = configured[p.key] || {};
    const hasKey = !!c.hasKey;
    const inUse = botCfg.provider === p.key;
    const noKeyNeeded = p.needs_key === false;
    return html`
    <button type="button" class="prov-card ${openKey === p.key ? 'selected' : ''} ${inUse ? 'in-use' : ''}"
            data-act="open" data-key="${p.key}">
        <span class="prov-name">${p.label}</span>
        <span class="prov-tags">
            ${inUse ? html`<span class="badge ok">使用中</span>` : ''}
            ${noKeyNeeded
                ? html`<span class="badge info">免密钥</span>`
                : hasKey ? html`<span class="badge ok">已配密钥</span>` : html`<span class="badge plain">未配置</span>`}
            ${p.verified ? '' : html`<span class="badge warn" title="这条记录按公开资料填写，本仓还没实测过，请先点「测试连接」">未实测</span>`}
        </span>
    </button>`;
}

function groupSection(region) {
    const items = catalog.filter(p => p.region === region.id);
    if (!items.length) return '';
    return html`
    <div class="section">
        <div class="section-title">${region.label} <span class="hint">${region.hint}</span></div>
        <div class="prov-grid">${items.map(providerCard)}</div>
        ${openKey && byKey(openKey)?.region === region.id ? detailPanel(byKey(openKey)) : ''}
    </div>`;
}

// ── 展开的配置面板 ──────────────────────────────────────────────────────────
function detailPanel(p) {
    const c = configured[p.key] || {};
    const hasKey = !!c.hasKey;
    const inUse = botCfg.provider === p.key;
    const models = modelCache[p.key] || p.models || [];
    const modelVal = inUse ? (botCfg.model || p.default_model || '') : (p.default_model || '');
    const think = inUse ? (botCfg.thinking || 'off') : 'off';
    const canThink = !!p.has_thinking_switch;

    return html`
    <div class="prov-detail" id="detail">
        <div class="row wrap between">
            <div>
                <div class="card-title" style="font-size:var(--fs-lg)">${p.label}</div>
                ${p.note ? html`<div class="field-help mt-2" style="max-width:60ch">${p.note}</div>` : ''}
            </div>
            <div class="btn-group">
                ${p.console ? html`<a class="btn sm outline" href="${p.console}" target="_blank" rel="noopener">${icons.link} 去申请密钥</a>` : ''}
                <button class="btn sm ghost" data-act="close">${icons.x} 收起</button>
            </div>
        </div>

        ${p.verified ? '' : html`
        <div class="notice warn mt-4">
            <span>${icons.alert}</span>
            <span>这家的地址和模型名是按公开资料填的，我们还没实测过。填好密钥后请先点「测试连接」确认。</span>
        </div>`}

        ${p.needs_key === false ? html`
        <div class="notice mt-4">
            <span>${icons.info}</span>
            <span>本机运行的模型不需要 API 密钥，确认下面的服务地址能连上就行。</span>
        </div>` : html`
        <div class="field mt-4">
            <label class="field-label" for="apiKey">API 密钥</label>
            <div class="input-affix">
                <input class="input" id="apiKey" type="password" autocomplete="off" spellcheck="false"
                       placeholder="${hasKey ? '已保存，留空则不修改' : '把控制台里复制的密钥粘贴到这里'}">
                <button type="button" class="affix-btn" data-act="toggle-key">显示</button>
            </div>
            <div class="field-help">
                ${hasKey
                    ? html`当前已保存：<span class="mono">${c.masked || '••••••••'}</span>。密钥只存在你自己电脑的 keys.json 里。`
                    : '密钥只存在你自己电脑的 keys.json 里，不会发给任何第三方。'}
            </div>
        </div>`}

        <div class="field mt-4">
            <button type="button" class="collapse-head ${c.base_url ? 'open' : ''}" data-act="toggle-url">
                ${icons.chevron} 服务地址（可选，一般不用改）
            </button>
            <div id="urlBox" class="${c.base_url ? '' : 'hidden'}" style="margin-top:6px">
                <input class="input" id="baseUrl" type="text" spellcheck="false"
                       value="${c.base_url || ''}"
                       placeholder="${p.base_url || '留空则使用官方默认地址'}">
                <div class="field-help mt-2">只有用代理/中转站时才需要填。留空 = 使用默认地址。</div>
            </div>
        </div>

        <div class="row wrap mt-4">
            <button class="btn" data-act="test">${icons.plug} 测试连接</button>
            <span class="small muted">会用上面的密钥试着拉一次模型列表，不消耗额度。</span>
        </div>
        <div id="testOut"></div>

        <hr class="divider">

        <div class="field">
            <label class="field-label" for="modelInput">使用哪个模型</label>
            <input class="input" id="modelInput" type="text" spellcheck="false" list="modelList"
                   value="${modelVal}" placeholder="${p.default_model || '例如 gpt-4o-mini'}">
            <datalist id="modelList">${models.map(m => html`<option value="${m}"></option>`)}</datalist>
            <div class="field-help">
                ${models.length
                    ? `可以从下拉里选（共 ${models.length} 个），也可以直接手输。`
                    : '点上面的「测试连接」可以拉到这家的真实模型列表；也可以直接手输模型名。'}
            </div>
        </div>

        <div class="field mt-4">
            <div class="field-label">思考模式</div>
            <div class="segmented ${canThink ? '' : 'disabled'}" id="thinkSeg">
                ${THINK_OPTIONS.map(t => html`
                    <button type="button" class="${think === t.id ? 'on' : ''}" data-act="think" data-val="${t.id}"
                            ${canThink ? '' : 'disabled'}>${t.label}</button>`)}
            </div>
            <div class="field-help" id="thinkHelp">
                ${canThink
                    ? (THINK_OPTIONS.find(t => t.id === think)?.help || '')
                    : '这家供应商没有独立的思考开关，要关思考请在上面选一个非推理版的模型。'}
            </div>
        </div>

        <div class="card-foot">
            <button class="btn primary" data-act="save">${icons.check} 保存并让 Bot 使用</button>
            <span class="small muted">保存后需要重启 Bot 才会生效，面板会提示你。</span>
        </div>
    </div>`;
}

// ── 整页 ────────────────────────────────────────────────────────────────────
function page() {
    return html`
    <div class="page-head">
        <div class="page-title">AI 配置</div>
        <div class="page-desc">Bot 靠大模型思考。挑一家供应商，填上密钥，测试通过就能开玩了。</div>
    </div>
    ${currentCard()}
    ${REGIONS.map(groupSection)}
    <div class="section">
        <div class="notice">
            <span>${icons.info}</span>
            <span>不知道选哪个？国内玩家推荐 <b>DeepSeek</b>：注册简单、便宜、不用梯子，模型选 <span class="mono">deepseek-chat</span> 即可。</span>
        </div>
    </div>`;
}

function fallbackPage(err) {
    return html`
    <div class="page-head">
        <div class="page-title">AI 配置</div>
    </div>
    <div class="card">
        <div class="row"><span class="badge warn">暂不可用</span></div>
        <p class="field-help mt-3">${err?.message || '读取供应商列表失败'}</p>
        <p class="field-help mt-2">如果程序刚启动，稍等几秒再试。</p>
        <div class="card-foot"><button class="btn" data-act="reload">重新加载</button></div>
    </div>`;
}

// ── 数据 ────────────────────────────────────────────────────────────────────
async function loadAll() {
    const provRes = await tryGet('/api/providers', null);
    if (!provRes.data) throw provRes.error || new Error('拿不到供应商列表');
    catalog = Array.isArray(provRes.data.providers) ? provRes.data.providers : [];
    configured = provRes.data.configured || {};

    const botRes = await tryGet('/api/bot', {});
    botCfg = botRes.data || {};
}

// ── 交互 ────────────────────────────────────────────────────────────────────
async function doTest(root, btn) {
    const p = byKey(openKey);
    if (!p) return;
    const keyInput = qs('#apiKey', root);
    const urlInput = qs('#baseUrl', root);
    const modelInput = qs('#modelInput', root);
    const out = qs('#testOut', root);
    const done = busy(btn);
    render(out, html`<div class="test-result">正在连接 ${p.label}…</div>`);
    try {
        const body = { model: modelInput?.value?.trim() || undefined };
        if (keyInput && keyInput.value.trim()) body.api_key = keyInput.value.trim();
        if (urlInput && urlInput.value.trim()) body.base_url = urlInput.value.trim();
        const res = await post(`/api/providers/${encodeURIComponent(p.key)}/test`, body);
        const models = Array.isArray(res.models) ? res.models : [];
        if (models.length) {
            modelCache[p.key] = models;
            const dl = qs('#modelList', root);
            if (dl) render(dl, html`${models.map(m => html`<option value="${m}"></option>`)}`);
        }
        render(out, html`
            <div class="test-result ok">
                ${icons.check} ${res.message || '连接成功！'}
                ${models.length ? html`<div class="mt-2">已拉到 ${models.length} 个可用模型，下拉框里选一个即可。</div>` : ''}
            </div>`);
    } catch (err) {
        render(out, html`<div class="test-result bad">${icons.x} ${err.message || '连接失败'}</div>`);
    } finally {
        done();
    }
}

async function doSave(root, btn, rerender) {
    const p = byKey(openKey);
    if (!p) return;
    const keyInput = qs('#apiKey', root);
    const urlInput = qs('#baseUrl', root);
    const modelInput = qs('#modelInput', root);
    const model = modelInput?.value?.trim() || '';
    if (!model) { toast('请先填一个模型名', 'warn'); modelInput?.focus(); return; }

    const done = busy(btn);
    try {
        if (p.needs_key !== false) {
            const typed = keyInput?.value?.trim() || '';
            const hasKey = !!configured[p.key]?.hasKey;
            if (!typed && !hasKey) throw new Error('还没填密钥，Bot 没法用这家供应商');
            await put(`/api/providers/${encodeURIComponent(p.key)}`, {
                api_key: typed || KEEP,
                base_url: urlInput?.value?.trim() ?? '',
            });
        } else {
            await put(`/api/providers/${encodeURIComponent(p.key)}`, { base_url: urlInput?.value?.trim() ?? '' });
        }

        const seg = qs('#thinkSeg .on', root);
        const thinking = seg?.dataset?.val || 'off';
        const res = await put('/api/bot', { provider: p.key, model, thinking });

        toast(res?.restartRequired ? '已保存。重启 Bot 后生效。' : '已保存', 'ok');
        await loadAll();
        rerender();
    } catch (err) {
        toastError(err, '保存失败');
    } finally {
        done();
    }
}

export async function mount(root) {
    // 每次进页面都从零开始，避免上一次的展开状态串味
    openKey = null;
    modelCache = {};

    try {
        await loadAll();
    } catch (err) {
        render(root, fallbackPage(err));
        return onAct(root, (act) => { if (act === 'reload') location.reload(); });
    }

    const paint = () => {
        render(root, page());
        if (openKey) {
            const d = qs('#detail', root);
            if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    };
    paint();

    return onAct(root, (act, elm) => {
        if (act === 'open') {
            openKey = openKey === elm.dataset.key ? null : elm.dataset.key;
            paint();
        } else if (act === 'close') {
            openKey = null;
            paint();
        } else if (act === 'toggle-key') {
            const inp = qs('#apiKey', root);
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            elm.textContent = show ? '隐藏' : '显示';
        } else if (act === 'toggle-url') {
            const box = qs('#urlBox', root);
            if (!box) return;
            box.classList.toggle('hidden');
            elm.classList.toggle('open', !box.classList.contains('hidden'));
        } else if (act === 'think') {
            for (const b of root.querySelectorAll('#thinkSeg button')) b.classList.toggle('on', b === elm);
            const help = qs('#thinkHelp', root);
            const opt = THINK_OPTIONS.find(t => t.id === elm.dataset.val);
            if (help && opt) help.textContent = opt.help;
        } else if (act === 'test') {
            doTest(root, elm);
        } else if (act === 'save') {
            doSave(root, elm, paint);
        }
    });
}

export default { meta, mount };
