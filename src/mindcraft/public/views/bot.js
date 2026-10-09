// views/bot.js — Bot 设定：名字 / 皮肤 / 人设。
//
// 后端契约：
//   GET/PUT /api/bot                 {name, conversing, skin:{file,variant}, ...}
//   GET    /api/skins                {skins:[{file,name,size,width,height,variant,current}], current}
//   POST   /api/skins                原始 PNG body + header X-Skin-Filename
//   PUT    /api/skins/current        {file, variant}
//   DELETE /api/skins/:file
//   GET    /api/skins/:file/preview.png
//
// ★ 文件名只走 ASCII：HTTP header 值不能带非 Latin-1 字符，中文文件名会让 fetch 直接抛。
//   所以上传前统一净化成 [A-Za-z0-9._-]，净化后为空就用时间戳兜底。

import { put, del, upload, tryGet, toast, toastError, confirmDialog, ApiError } from '../lib/api.js';
import { html, render, onAct, icons, qs, busy } from '../lib/dom.js';
import { boot } from '../lib/store.js';

export const meta = { title: 'Bot 设定', desc: '名字、皮肤和人设' };

const VARIANTS = [
    { id: 'classic', label: '经典（手臂 4 像素宽）' },
    { id: 'slim', label: '纤细（手臂 3 像素宽）' },
];

let botCfg = {};
let skins = [];
let currentSkin = null;
let variant = 'classic';
let skinsAvailable = true;

function safeName(name) {
    const base = String(name || '').replace(/\.png$/i, '');
    const ascii = base.replace(/[^A-Za-z0-9._-]/g, '');
    return `${ascii || `skin-${Date.now()}`}.png`;
}

/** 读 PNG 尺寸并校验（Minecraft 皮肤只接受 64×64 或 64×32）。 */
function validateSkin(file) {
    return new Promise((resolve, reject) => {
        if (!/\.png$/i.test(file.name) && file.type !== 'image/png') {
            reject(new Error('只支持 PNG 格式的皮肤文件'));
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            reject(new Error('文件太大了，皮肤 PNG 一般只有几 KB'));
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const w = img.naturalWidth, h = img.naturalHeight;
            if (w === 64 && (h === 64 || h === 32)) resolve({ width: w, height: h });
            else reject(new Error(`皮肤尺寸必须是 64×64 或 64×32，这张是 ${w}×${h}`));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这个文件打不开，可能不是有效的 PNG 图片')); };
        img.src = url;
    });
}

// ── 页面 ────────────────────────────────────────────────────────────────────
/**
 * 皮肤到底生效没有 —— 由 agent 发完 /skin 后听服务端回执得出，经 /api/bot 的 skinStatus 传来。
 *
 * ★2026-09-09: 之前这里只有一句"需要装 FabricTailor"的泛泛提示，用户没法判断自己到底
 *   装没装、这次到底成没成 —— 实录: 服务端没装，皮肤永远不变，而面板上一切看着正常。
 *   现在把真实结果显示出来，并且只在**确实失败**时才给安装指引。
 */
function skinStatusNotice() {
    const st = botCfg && botCfg.skinStatus;
    if (!st) {
        return html`<div class="notice mt-4">
            <span>${icons.info}</span>
            <span>皮肤是否生效要等 Bot 进入游戏后才知道。它需要 Minecraft 服务端装有
                  <b>FabricTailor</b> 模组；没装的话这里选了也只在面板里看得到。</span>
        </div>`;
    }
    if (st.ok === true) {
        return html`<div class="notice ok mt-4">
            <span>${icons.check}</span>
            <span>皮肤已在游戏里生效。</span>
        </div>`;
    }
    if (st.reason === 'NO_MOD') {
        return html`<div class="notice warn mt-4">
            <span>${icons.info}</span>
            <span><b>皮肤没能生效：你的服务端没装 FabricTailor 模组。</b><br>
                  Bot 发出的 <code>/skin</code> 命令服务端不认识。装上
                  <a href="https://modrinth.com/mod/fabrictailor" target="_blank" rel="noreferrer">FabricTailor</a>
                  （要和你的 Minecraft 版本对应）后重启服务器，Bot 重连就会自动套上。<br>
                  不装也完全不影响其他功能，只是她顶着默认皮肤。</span>
        </div>`;
    }
    if (st.reason === 'NO_PERMISSION') {
        return html`<div class="notice warn mt-4">
            <span>${icons.info}</span>
            <span><b>皮肤没能生效：服务端拒绝了 /skin（权限不足）。</b><br>
                  需要给 Bot 的账号相应权限，或在服务端放开该命令。</span>
        </div>`;
    }
    return html`<div class="notice mt-4">
        <span>${icons.info}</span>
        <span>皮肤命令已发出，但服务端没有明确回执。若游戏里皮肤没变，多半是没装
              <a href="https://modrinth.com/mod/fabrictailor" target="_blank" rel="noreferrer">FabricTailor</a> 模组。</span>
    </div>`;
}

function skinCard(s) {
    const isCurrent = s.file === currentSkin;
    return html`
    <div class="skin-card ${isCurrent ? 'current' : ''}" data-act="pick-skin" data-file="${s.file}"
         title="${s.name || s.file}${s.width ? `（${s.width}×${s.height}）` : ''}">
        <div class="skin-thumb">
            <img src="/api/skins/${encodeURIComponent(s.file)}/preview.png" alt="${s.name || s.file}" loading="lazy"
                 onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tiny muted',textContent:'无预览'}))">
        </div>
        <div class="skin-name">${s.name || s.file}</div>
        ${isCurrent ? html`<span class="skin-check">${icons.check}</span>` : ''}
        <button type="button" class="skin-del" data-act="del-skin" data-file="${s.file}" title="删除这张皮肤">${icons.x}</button>
    </div>`;
}

function page() {
    const persona = botCfg.conversing || '';
    return html`
    <div class="page-head">
        <div class="page-title">Bot 设定</div>
        <div class="page-desc">给它起个名字、挑张皮肤，再决定它是个什么性格的伙伴。</div>
    </div>

    <div class="card">
        <div class="card-head"><span class="card-title">名字</span></div>
        <div class="field">
            <input class="input" id="botName" type="text" maxlength="16" spellcheck="false"
                   value="${botCfg.name || ''}" placeholder="例如 Neko">
            <div class="field-help">这是它在游戏里显示的 ID。只能用字母、数字和下划线，最多 16 个字符。改名后需要重启 Bot。</div>
        </div>
        <div class="card-foot"><button class="btn primary" data-act="save-name">${icons.check} 保存名字</button></div>
    </div>

    <div class="section">
        <div class="section-title">皮肤 <span class="hint">点一张即可应用</span></div>
        <div class="card">
            ${skinsAvailable ? html`
                ${skins.length
                    ? html`<div class="skin-grid">${skins.map(skinCard)}</div>`
                    : html`<div class="empty">${icons.cube}<span>还没有导入过皮肤</span></div>`}

                <div class="dropzone mt-4" id="drop" data-act="pick-file">
                    ${icons.upload}
                    <div>把皮肤 PNG 拖到这里，或者点击选择文件</div>
                    <div class="tiny mt-2">只接受 64×64 或 64×32 的 PNG</div>
                </div>
                <input type="file" id="fileInput" accept="image/png,.png" class="hidden">

                <div class="field mt-4">
                    <div class="field-label">手臂样式</div>
                    <div class="segmented" id="variantSeg">
                        ${VARIANTS.map(v => html`
                            <button type="button" class="${variant === v.id ? 'on' : ''}" data-act="variant" data-val="${v.id}">${v.label}</button>`)}
                    </div>
                    <div class="field-help">Alex 类（细手臂）的皮肤选「纤细」，Steve 类选「经典」。</div>
                </div>
            ` : html`
                <div class="empty">${icons.alert}<span>皮肤功能的后端接口还没准备好</span></div>`}

            ${skinStatusNotice()}
        </div>
    </div>

    <div class="section">
        <div class="section-title">人设 <span class="hint">决定它说话的口气和行事风格</span></div>
        <div class="card">
            <div class="field">
                <textarea class="textarea tall" id="persona" spellcheck="false"
                          placeholder="例如：你是一只叫 Neko 的猫娘，陪主人一起玩 Minecraft。说话简短活泼，遇到危险先保护主人。">${persona}</textarea>
                <div class="row between">
                    <div class="field-help">写给 AI 看的自我介绍。写得越具体，它的行为越稳定。</div>
                    <span class="small muted mono" id="personaCount">${persona.length} 字</span>
                </div>
            </div>
            <div class="card-foot">
                <button class="btn primary" data-act="save-persona">${icons.check} 保存人设</button>
                <span class="small muted">保存后重启 Bot 生效。</span>
            </div>
        </div>
    </div>`;
}

// ── 数据 ────────────────────────────────────────────────────────────────────
async function loadAll() {
    const botRes = await tryGet('/api/bot', {});
    botCfg = botRes.data || {};
    if (!botCfg.name) botCfg.name = boot.value?.botName || '';
    variant = botCfg.skin?.variant || 'classic';

    const skinRes = await tryGet('/api/skins', null);
    if (skinRes.data) {
        skinsAvailable = true;
        skins = Array.isArray(skinRes.data.skins) ? skinRes.data.skins : [];
        currentSkin = skinRes.data.current || botCfg.skin?.file || skins.find(s => s.current)?.file || null;
        const cur = skins.find(s => s.file === currentSkin);
        if (cur?.variant) variant = cur.variant;
    } else {
        skinsAvailable = !(skinRes.error instanceof ApiError && skinRes.error.missing);
        skins = [];
        currentSkin = botCfg.skin?.file || null;
    }
}

// ── 动作 ────────────────────────────────────────────────────────────────────
async function saveName(root, btn) {
    const input = qs('#botName', root);
    const name = (input?.value || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
        toast('名字只能用字母、数字和下划线，长度 3–16', 'warn');
        input?.focus();
        return;
    }
    const done = busy(btn);
    try {
        const res = await put('/api/bot', { name });
        botCfg.name = name;
        toast(res?.restartRequired ? '名字已保存，重启 Bot 后生效' : '名字已保存', 'ok');
    } catch (err) { toastError(err, '保存失败'); }
    finally { done(); }
}

async function savePersona(root, btn) {
    const ta = qs('#persona', root);
    const done = busy(btn);
    try {
        const res = await put('/api/bot', { conversing: ta.value });
        botCfg.conversing = ta.value;
        toast(res?.restartRequired ? '人设已保存，重启 Bot 后生效' : '人设已保存', 'ok');
    } catch (err) { toastError(err, '保存失败'); }
    finally { done(); }
}

async function applySkin(file, rerender) {
    try {
        await put('/api/skins/current', { file, variant });
        currentSkin = file;
        toast('皮肤已应用，重启 Bot 后在游戏里生效', 'ok');
        rerender();
    } catch (err) { toastError(err, '应用皮肤失败'); }
}

async function removeSkin(file, rerender) {
    const yes = await confirmDialog({
        title: '删除皮肤',
        body: `确定要删除「${file}」吗？删了之后要重新导入。`,
        okText: '删除',
    });
    if (!yes) return;
    try {
        await del(`/api/skins/${encodeURIComponent(file)}`);
        skins = skins.filter(s => s.file !== file);
        if (currentSkin === file) currentSkin = null;
        toast('已删除', 'ok');
        rerender();
    } catch (err) { toastError(err, '删除失败'); }
}

async function uploadSkin(file, rerender) {
    try {
        await validateSkin(file);
    } catch (err) {
        toast(err.message, 'warn', 5200);
        return;
    }
    try {
        const buf = await file.arrayBuffer();
        const res = await upload('/api/skins', new Blob([buf], { type: 'image/png' }), {
            'Content-Type': 'image/png',
            'X-Skin-Filename': safeName(file.name),
        });
        toast(`已导入「${res.file || file.name}」`, 'ok');
        await loadAll();
        rerender();
    } catch (err) { toastError(err, '导入失败'); }
}

// ── 装载 ────────────────────────────────────────────────────────────────────
export async function mount(root) {
    await loadAll();

    let cleanupDrop = () => {};
    const paint = () => {
        render(root, page());
        cleanupDrop();
        cleanupDrop = wireDropzone(root, paint);
        const ta = qs('#persona', root);
        const count = qs('#personaCount', root);
        if (ta && count) {
            const upd = () => { count.textContent = `${ta.value.length} 字`; };
            ta.addEventListener('input', upd);
        }
    };
    paint();

    const offAct = onAct(root, (act, elm, ev) => {
        if (act === 'save-name') saveName(root, elm);
        else if (act === 'save-persona') savePersona(root, elm);
        else if (act === 'pick-file') qs('#fileInput', root)?.click();
        else if (act === 'variant') {
            variant = elm.dataset.val;
            for (const b of root.querySelectorAll('#variantSeg button')) b.classList.toggle('on', b === elm);
            if (currentSkin) applySkin(currentSkin, paint);
        } else if (act === 'del-skin') {
            ev.stopPropagation();
            removeSkin(elm.dataset.file, paint);
        } else if (act === 'pick-skin') {
            applySkin(elm.dataset.file, paint);
        }
    });

    return () => { offAct(); cleanupDrop(); };
}

/** 拖拽 + 文件选择。每次重绘后要重新接上。 */
function wireDropzone(root, rerender) {
    const drop = qs('#drop', root);
    const input = qs('#fileInput', root);
    if (!drop || !input) return () => {};

    const onChange = () => {
        const f = input.files?.[0];
        if (f) uploadSkin(f, rerender);
        input.value = '';
    };
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onOver = (e) => { stop(e); drop.classList.add('over'); };
    const onLeave = (e) => { stop(e); drop.classList.remove('over'); };
    const onDrop = (e) => {
        stop(e);
        drop.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) uploadSkin(f, rerender);
    };

    input.addEventListener('change', onChange);
    drop.addEventListener('dragover', onOver);
    drop.addEventListener('dragenter', onOver);
    drop.addEventListener('dragleave', onLeave);
    drop.addEventListener('drop', onDrop);

    return () => {
        input.removeEventListener('change', onChange);
        drop.removeEventListener('dragover', onOver);
        drop.removeEventListener('dragenter', onOver);
        drop.removeEventListener('dragleave', onLeave);
        drop.removeEventListener('drop', onDrop);
    };
}

export default { meta, mount };
