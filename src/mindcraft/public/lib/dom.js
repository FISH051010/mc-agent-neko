// dom.js — 极简 DOM 工具。三件套：
//   html`` 模板串（插值自动转义，防注入）  ·  h() 直建元素  ·  on() 事件委托
// 视图统一用 html`` 出结构、data-act 出交互，避免满屏 addEventListener。

class Raw {
    constructor(s) { this.s = String(s); }
    toString() { return this.s; }
}

/** 标记一段已经安全的 HTML，跳过转义。只用于自己拼的结构，别喂用户输入。 */
export function raw(s) { return new Raw(s); }

export function esc(v) {
    return String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function part(v) {
    if (v === null || v === undefined || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(part).join('');
    return esc(v);
}

/** 用法：html`<div class="${cls}">${raw(childHtml)}</div>` */
export function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
    return new Raw(out);
}

/** HTML 串 → 单个元素 */
export function el(src) {
    const t = document.createElement('template');
    t.innerHTML = String(src).trim();
    return t.content.firstElementChild;
}

/** HTML 串 → 文档片段（可含多个顶层节点） */
export function frag(src) {
    const t = document.createElement('template');
    t.innerHTML = String(src);
    return t.content;
}

/** 把 HTML 串整体渲染进容器（替换原有内容） */
export function render(root, src) {
    root.replaceChildren(frag(src));
    return root;
}

function appendKids(node, kids) {
    for (const k of kids.flat(Infinity)) {
        if (k === null || k === undefined || k === false || k === true) continue;
        if (k instanceof Node) node.appendChild(k);
        else if (k instanceof Raw) node.appendChild(frag(k.s));
        else node.appendChild(document.createTextNode(String(k)));
    }
}

/** h('button', {class:'btn', onclick:fn}, '文字') */
export function h(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in node) { try { node[k] = v; } catch { node.setAttribute(k, v); } }
        else node.setAttribute(k, v === true ? '' : v);
    }
    appendKids(node, kids);
    return node;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 事件委托。返回取消函数。 */
export function on(root, type, selector, handler) {
    const fn = (ev) => {
        const target = ev.target instanceof Element ? ev.target.closest(selector) : null;
        if (target && root.contains(target)) handler(ev, target);
    };
    root.addEventListener(type, fn);
    return () => root.removeEventListener(type, fn);
}

/**
 * data-act 委托：<button data-act="save">。handler(actName, element, event)。
 * 一个视图一次委托，省掉逐个绑定与解绑。
 */
export function onAct(root, handler, type = 'click') {
    return on(root, type, '[data-act]', (ev, target) => handler(target.dataset.act, target, ev));
}

/** 按钮忙碌态（转圈 + 禁点），返回恢复函数。 */
export function busy(btn) {
    if (!btn) return () => {};
    btn.classList.add('loading');
    btn.disabled = true;
    return () => { btn.classList.remove('loading'); btn.disabled = false; };
}

// ── 常用图标（内联 SVG，避免任何外部请求） ────────────────────────────────
const I = (d, extra = '') => raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`
);
export const icons = {
    play: I('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>'),
    stop: I('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
    restart: I('<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>'),
    x: I('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    chevron: I('<polyline points="9 18 15 12 9 6"/>'),
    eye: I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    camera: I('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    upload: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    trash: I('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    alert: I('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    info: I('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    cube: I('<path d="m21 16-9 5-9-5V8l9-5 9 5z"/><polyline points="3 8 12 13 21 8"/><line x1="12" y1="13" x2="12" y2="21"/>'),
    sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
    auto: I('<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none"/>'),
    send: I('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
    link: I('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    plug: I('<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>'),
};
