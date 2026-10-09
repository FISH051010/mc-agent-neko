// api.js — 面板 REST 封装。
//
// 后端统一信封：成功 {ok:true, ...}；失败 {ok:false, error:"中文提示", code:"..."}。
// ★ 降级原则：接口可能还没就绪（404）或后端出错（500），前端一律不能白屏。
//   要「有就用、没有就退回默认」的地方用 tryGet()；要给用户明确反馈的地方用 get/put + toast。

export class ApiError extends Error {
    constructor(message, { code = '', status = 0, body = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.body = body;
    }
    /** 接口压根没实现（后端还没接上）——调用方据此走降级分支而不是报错 */
    get missing() { return this.status === 404 || this.code === 'NOT_IMPLEMENTED'; }
}

function statusText(status) {
    if (status === 404) return '这个功能的后端接口还没准备好';
    if (status === 401 || status === 403) return '没有权限访问（面板只允许本机打开）';
    if (status === 413) return '内容太大，服务器拒绝了';
    if (status >= 500) return '后端出错了，可以看看「高级 → 运行日志」';
    return `请求失败（HTTP ${status}）`;
}

async function parseBody(res) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try { return await res.json(); } catch { return null; }
    }
    try {
        const text = await res.text();
        return text ? { _text: text.slice(0, 300) } : null;
    } catch { return null; }
}

async function request(method, path, { body, headers, rawBody } = {}) {
    let res;
    try {
        res = await fetch(path, {
            method,
            headers: rawBody
                ? { ...(headers || {}) }
                : { 'Content-Type': 'application/json', ...(headers || {}) },
            body: rawBody ? body : (body === undefined ? undefined : JSON.stringify(body)),
        });
    } catch (err) {
        // 网络层就断了：多半是主程序退出了
        throw new ApiError('连不上本机服务，请确认程序还在运行', { code: 'NETWORK', status: 0, body: err });
    }

    const data = await parseBody(res);
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || statusText(res.status);
        throw new ApiError(msg, { code: data?.code || '', status: res.status, body: data });
    }
    if (data && data.ok === false) {
        // ★ 有些接口（如 /providers/:key/test）故意用 HTTP 200 + ok:false 回失败，
        //   把给人看的中文放在 message 里而不是 error。两个字段都要认，否则用户只会
        //   看到「操作没有成功」这种废话。
        const msg = data.error || data.message || '操作没有成功';
        throw new ApiError(msg, { code: data.code || '', status: res.status, body: data });
    }
    return data ?? {};
}

export const get = (path) => request('GET', path);
export const post = (path, body) => request('POST', path, { body });
export const put = (path, body) => request('PUT', path, { body });
export const del = (path) => request('DELETE', path);

/** 上传原始二进制（皮肤 PNG）。 */
export const upload = (path, blob, headers) =>
    request('POST', path, { body: blob, rawBody: true, headers: { 'Content-Type': 'application/octet-stream', ...headers } });

/**
 * 静默降级读取：接口不存在/出错时返回 fallback，不抛。
 * 返回 { data, error }，error 非空表示走了降级分支。
 */
export async function tryGet(path, fallback = null) {
    try {
        return { data: await get(path), error: null };
    } catch (err) {
        console.warn(`[api] ${path} 降级:`, err.message);
        return { data: fallback, error: err };
    }
}

/** 带缓存击穿参数的资源地址（截图这类会变的静态资源用它）。 */
export function bust(path) {
    return `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
}

// ── 提示条 ──────────────────────────────────────────────────────────────────
let toastHost = null;
export function toast(message, kind = 'info', ms = 3400) {
    if (!toastHost) toastHost = document.getElementById('toasts');
    if (!toastHost) { console.log(`[toast:${kind}]`, message); return; }
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = String(message);
    toastHost.appendChild(node);
    const kill = () => {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), 250);
    };
    const timer = setTimeout(kill, ms);
    node.addEventListener('click', () => { clearTimeout(timer); kill(); });
}

/** 把异常翻成中文提示弹出来。 */
export function toastError(err, prefix = '') {
    const msg = err instanceof ApiError ? err.message : (err?.message || '未知错误');
    toast(prefix ? `${prefix}：${msg}` : msg, 'err', 5200);
}

/** 二次确认弹层（危险操作用）。返回 Promise<boolean>。 */
export function confirmDialog({ title = '确认操作', body = '', okText = '确认', danger = true } = {}) {
    return new Promise((resolve) => {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="modal" role="dialog" aria-modal="true">
                <h3></h3>
                <div class="modal-body"></div>
                <div class="modal-foot">
                    <button class="btn" data-no>取消</button>
                    <button class="btn ${danger ? 'danger' : 'primary'}" data-yes></button>
                </div>
            </div>`;
        mask.querySelector('h3').textContent = title;
        mask.querySelector('.modal-body').textContent = body;
        mask.querySelector('[data-yes]').textContent = okText;
        const close = (v) => { mask.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') close(false); };
        mask.addEventListener('click', (e) => {
            if (e.target === mask || e.target.closest('[data-no]')) close(false);
            else if (e.target.closest('[data-yes]')) close(true);
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(mask);
        mask.querySelector('[data-yes]').focus();
    });
}

export default { get, post, put, del, upload, tryGet, toast, toastError, confirmDialog, bust, ApiError };
