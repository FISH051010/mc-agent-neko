// provider_test.js — 控制面板的「测试连接」后端。
//
// 为什么用**裸 fetch** 而不是 openai SDK：SDK 自带重试 + 错误包装，
// 一次 401 会被重试成好几秒，而且抛出来的错误分不清"密钥错"还是"网络不通"。
// 面板要的是"一句人话告诉玩家该改什么"，所以这里自己发请求、自己分类。
//
// 所有 message 都是给**普通玩家**看的，不许出现术语黑话。

import { getProvider } from './providers.js';

const TIMEOUT_MS = 10000;

/** 每个错误码配一句中文人话。面板直接显示。 */
const CODE_TEXT = {
    ok:                '连接成功，可以用了。',
    auth_failed:       'API 密钥不对。请回供应商官网重新复制一次，注意别多复制空格。',
    model_not_found:   '这个模型名不存在，或者你的账号还没开通它。请换一个模型再试。',
    quota:             '账号余额不足或额度用完了。请到供应商官网充值/领取额度后再试。',
    rate_limited:      '密钥是好的，但当前请求太频繁被限速了。等一会儿再用就行。',
    dns_error:         '找不到服务器地址。请检查接口地址有没有写错，以及电脑能不能正常上网。',
    connection_refused:'连不上服务器。如果是本机模型，请先把它启动起来；如果是在线服务，请检查网络或代理。',
    timeout:           '连接超时（10 秒没有响应）。可能是网络不通，境外服务通常需要代理。',
    tls_error:         '安全连接建立失败。常见原因是接口地址写成了 http/https 搞反，或者本机时间不对。',
    http_error:        '服务器返回了错误。请检查接口地址和模型名是否正确。',
    bad_config:        '缺少接口地址。请先在「API 配置」页填写这家供应商的接口地址。',
};

function normalizeBase(providerKey, base_url) {
    const spec = getProvider(providerKey);
    let base = (base_url && String(base_url).trim()) || (spec?.base_url || '').trim();
    if (!base && providerKey === 'openai') base = 'https://api.openai.com/v1';
    base = base.replace(/\/+$/, '');
    // Ollama 的原生地址不带 /v1，但它同时提供了 OpenAI 兼容层
    if (base && providerKey === 'ollama' && !/\/v\d+$/.test(base)) base += '/v1';
    return base;
}

function authHeaders(api_key) {
    const h = { 'Content-Type': 'application/json' };
    if (api_key) h['Authorization'] = `Bearer ${api_key}`;
    return h;
}

/**
 * 把 fetch 抛出来的网络异常分类。
 * ★注意 undici 的错误是**套娃**的：外层永远是 TypeError('fetch failed')，
 *   真正的 code 藏在 err.cause（有时还要再往下一层，或者是 AggregateError.errors）。
 *   只看第一层会把所有网络故障都错判成"服务器返回了错误"。
 */
function collectErrorInfo(err, out = { codes: [], msgs: [] }, depth = 0) {
    if (!err || depth > 4) return out;
    if (err.code) out.codes.push(String(err.code).toUpperCase());
    if (err.name) out.codes.push(String(err.name).toUpperCase());
    if (err.message) out.msgs.push(String(err.message));
    if (Array.isArray(err.errors)) for (const sub of err.errors) collectErrorInfo(sub, out, depth + 1);
    if (err.cause) collectErrorInfo(err.cause, out, depth + 1);
    return out;
}

function classifyNetworkError(err) {
    const { codes, msgs } = collectErrorInfo(err);
    const code = codes.join(' ');
    const msg = msgs.join(' ');
    if (/\bABORTERROR\b|\bTIMEOUTERROR\b/.test(code)) return 'timeout';
    if (/\b(ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED)\b/.test(code)) return 'dns_error';
    if (/\b(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/.test(code)) return 'timeout';
    if (/CERT|SELF_SIGNED|ERR_TLS|ERR_SSL|EPROTO/.test(code)) return 'tls_error';
    if (/certificate|ssl|tls|wrong version number/i.test(msg)) return 'tls_error';
    if (/\b(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_SOCKET)\b/.test(code)) return 'connection_refused';
    if (/socket hang up|fetch failed|other side closed/i.test(msg)) return 'connection_refused';
    return 'http_error';
}

/** 从 HTTP 状态码 + 响应正文里判断到底是哪种失败。 */
function classifyHttp(status, bodyText) {
    const body = String(bodyText || '').toLowerCase();
    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 429) return 'rate_limited';
    if (status === 402) return 'quota';
    if (/insufficient|balance|quota|欠费|余额|额度/.test(body)) return 'quota';
    if (status === 404) return 'model_not_found';
    if (status === 400 && /model/.test(body) && /(not found|not exist|does not exist|unsupported|invalid|无效|不存在)/.test(body)) {
        return 'model_not_found';
    }
    if (/api key|apikey|token.*invalid|invalid.*token|unauthor|鉴权|密钥/.test(body) && status >= 400 && status < 500) {
        return 'auth_failed';
    }
    return 'http_error';
}

async function fetchWithTimeout(url, init, timeout = TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 拉这家供应商真实可用的模型清单。拿不到就返回空数组 —— 不算失败，
 * 很多国内网关根本没开 /models 这个接口。
 * @returns {Promise<string[]>}
 */
export async function fetchModels(providerKey, { api_key, base_url } = {}) {
    const base = normalizeBase(providerKey, base_url);
    if (!base) return [];
    try {
        const resp = await fetchWithTimeout(`${base}/models`, { method: 'GET', headers: authHeaders(api_key) });
        if (!resp.ok) return [];
        const data = await resp.json();
        const list = Array.isArray(data) ? data : (data?.data || data?.models || []);
        if (!Array.isArray(list)) return [];
        return list
            .map(m => (typeof m === 'string' ? m : (m?.id || m?.name || m?.model)))
            .filter(x => typeof x === 'string' && x)
            .sort();
    } catch {
        return [];
    }
}

/**
 * 测一家供应商的密钥/地址/模型是否可用。
 * @param {string} providerKey providers.js 里的 key
 * @param {{api_key?:string, base_url?:string, model?:string}} opts
 * @returns {Promise<{ok:boolean, code:string, message:string, status:number|null,
 *                    provider:string, base_url:string, model:string, models:string[], detail:string}>}
 */
export async function testProvider(providerKey, { api_key, base_url, model } = {}) {
    const spec = getProvider(providerKey);
    const base = normalizeBase(providerKey, base_url);
    const use_model = (model && String(model).trim()) || spec?.default_model || '';

    const done = (code, extra = {}) => ({
        ok: code === 'ok' || code === 'rate_limited',   // 429 说明密钥是有效的，只是被限速
        code,
        message: CODE_TEXT[code] || CODE_TEXT.http_error,
        status: null,
        provider: providerKey,
        base_url: base,
        model: use_model,
        models: [],
        detail: '',
        ...extra,
    });

    if (!spec) {
        return done('bad_config', { message: `没有名为「${providerKey}」的供应商。` });
    }
    if (!base) return done('bad_config');
    if (spec.key_name && !api_key) {
        return done('auth_failed', { message: '还没填 API 密钥。请先填写再点测试。' });
    }
    if (!use_model) {
        return done('model_not_found', { message: '还没选模型。请先在上面挑一个模型再点测试。' });
    }

    // 先发一次极小的对话请求验密钥。max_tokens 给 1，花不了钱也不会等太久。
    const url = `${base}/chat/completions`;
    const basePayload = {
        model: use_model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
    };

    let resp, bodyText = '';
    try {
        resp = await fetchWithTimeout(url, {
            method: 'POST',
            headers: authHeaders(api_key),
            body: JSON.stringify({ ...basePayload, max_tokens: 1 }),
        });
        bodyText = await resp.text();

        // 新一代 OpenAI 模型把 max_tokens 换成了 max_completion_tokens，
        // 只因为这个 400 就报"连不上"会误导用户，换个字段重试一次。
        if (resp.status === 400 && /max_tokens/i.test(bodyText)) {
            resp = await fetchWithTimeout(url, {
                method: 'POST',
                headers: authHeaders(api_key),
                body: JSON.stringify({ ...basePayload, max_completion_tokens: 16 }),
            });
            bodyText = await resp.text();
        }
    } catch (err) {
        const code = classifyNetworkError(err);
        return done(code, { detail: String(err?.cause?.message || err?.message || err) });
    }

    if (!resp.ok) {
        const code = classifyHttp(resp.status, bodyText);
        const out = done(code, { status: resp.status, detail: bodyText.slice(0, 400) });
        if (code === 'rate_limited') {
            // 限速说明密钥有效，顺手把模型清单也拉一下
            out.models = await fetchModels(providerKey, { api_key, base_url: base });
        }
        return out;
    }

    const out = done('ok', { status: resp.status });
    out.models = await fetchModels(providerKey, { api_key, base_url: base });
    return out;
}

export { CODE_TEXT as PROVIDER_TEST_MESSAGES };
export default { testProvider, fetchModels, PROVIDER_TEST_MESSAGES: CODE_TEXT };
