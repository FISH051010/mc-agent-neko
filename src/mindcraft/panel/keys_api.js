// keys_api.js — API 密钥的面板视图层。包一层 utils/keys.js。
//
// 两条不可动摇的规则：
//   1. **响应里永远不出现明文密钥**，只回掩码。面板页面在浏览器里，浏览器扩展、
//      截图、录屏、F12 都能看到响应体；把 key 原文回传等于公开它。
//   2. 写入时 api_key === "__KEEP__" 表示"保留原值"。这条必须实现 —— 否则用户
//      打开面板看到一串 •••• 直接点保存，就把真 key 覆盖成了那串星号，
//      而且因为规则 1 他永远看不出来是什么时候坏的。

import {
    getProviderCredentials, setProviderCredentials, reloadKeys, profileKeyStatus, KEYS_FILE,
} from '../../utils/keys.js';
// bot_store 不 import 本模块，不会成环
import { readRaw as readBotProfile } from './bot_store.js';
import { listProviders, getProvider, catalogForPanel } from '../../models/providers.js';

export const KEEP_SENTINEL = '__KEEP__';

/** sk-abcd...xy → sk-a••••••••xy。长度 < 8 一律全掩。 */
export function maskKey(key) {
    const s = String(key || '');
    if (!s) return '';
    if (s.length < 8) return '••••••••';
    return `${s.slice(0, 4)}••••••••${s.slice(-2)}`;
}

/** 每个 provider 的配置状态（无明文）。 */
export function configuredMap() {
    const out = {};
    for (const p of listProviders()) {
        const { api_key, base_url } = getProviderCredentials(p.key, p.key_name);
        out[p.key] = {
            hasKey: !!api_key,
            masked: maskKey(api_key),
            base_url: base_url || '',
        };
    }
    return out;
}

/** GET /api/providers 的响应体。 */
export function panelView() {
    return { providers: catalogForPanel(), configured: configuredMap() };
}

/** 有没有任何一个能用的密钥（本机 provider 不算 —— 它不需要 key 但也未必装了）。 */
/**
 * bot 现在能不能开跑。
 *
 * ★2026-09-07 修（用户反馈「本地模型没有 key 没法用」）：
 *   旧实现问的是「全局有没有任何一家配了密钥」，而且 `if (!p.key_name) continue`
 *   直接把本机 provider 跳过了 —— 于是只配 Ollama / LM Studio 的用户，keysReady
 *   恒为 false，面板顶部永远挂着「还没配置 AI 密钥」、概览页状态恒为 pending，
 *   看上去就是「本地模型用不了」（实际后端能跑，纯粹是这个闸问错了问题）。
 *
 *   正确的问题是「**bot 当前选的那家**能不能用」，判据与 main.js 决定要不要拉起
 *   agent 用的是同一个 profileKeyStatus()，不再各写一套。
 */
export function anyKeyReady() {
    try {
        return profileKeyStatus(readBotProfile()).ready;
    } catch {
        return false;
    }
}

/**
 * 写入某个 provider 的凭据。
 * @throws {Error} 中文 message
 */
export function saveProvider(providerKey, body = {}) {
    const p = getProvider(providerKey);
    if (!p) throw new Error(`不认识的服务商「${providerKey}」。`);

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'api_key')) {
        const v = body.api_key;
        if (v === KEEP_SENTINEL) {
            // 保留原值：什么都不传给底层
        } else if (typeof v === 'string') {
            const trimmed = v.trim();
            // 用户把掩码原样提交回来了 —— 同样按"保留原值"处理，防止把真 key 写成 ••••
            if (trimmed.includes('••')) {
                // 什么都不做
            } else {
                patch.api_key = trimmed;
            }
        } else if (v === null) {
            patch.api_key = '';
        } else {
            throw new Error('密钥必须是一段文字。');
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'base_url')) {
        const u = body.base_url;
        if (u === null || u === undefined || u === '') {
            patch.base_url = '';
        } else if (typeof u === 'string') {
            const s = u.trim();
            if (s && !/^https?:\/\//i.test(s)) throw new Error('接口地址要以 http:// 或 https:// 开头。');
            patch.base_url = s;
        } else {
            throw new Error('接口地址必须是一段文字。');
        }
    }

    const next = setProviderCredentials(providerKey, patch);
    reloadKeys();
    return { hasKey: !!next.api_key, masked: maskKey(next.api_key), base_url: next.base_url || '' };
}

// ── 连接测试 ────────────────────────────────────────────────────────────────
// 统一走"拉模型列表"这个最轻的只读请求：不消耗 token、能同时验密钥和网络，
// 顺便把真实模型名带回来给面板做下拉框（注册表里的 models[] 只是建议起点，会过期）。

function withTimeout(ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    return { signal: ctl.signal, done: () => clearTimeout(timer) };
}

function endpointFor(p, apiKey, baseUrl) {
    const base = (baseUrl || p.base_url || '').replace(/\/+$/, '');
    switch (p.key) {
        case 'anthropic':
            return {
                url: `${base || 'https://api.anthropic.com/v1'}/models`,
                headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                pick: j => (j?.data || []).map(m => m.id),
            };
        case 'google':
            return {
                url: `${base || 'https://generativelanguage.googleapis.com/v1beta'}/models?key=${encodeURIComponent(apiKey)}`,
                headers: {},
                pick: j => (j?.models || []).map(m => String(m.name || '').replace(/^models\//, '')),
            };
        case 'ollama':
            return {
                url: `${base || 'http://127.0.0.1:11434'}/api/tags`,
                headers: {},
                pick: j => (j?.models || []).map(m => m.name),
            };
        default: {
            // OpenAI 及一切 OpenAI 兼容网关
            const root = base || 'https://api.openai.com/v1';
            return {
                url: `${root}/models`,
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                pick: j => (j?.data || []).map(m => m.id),
            };
        }
    }
}

/**
 * 测试连接。永远 resolve，不抛 —— 面板要拿到中文原因展示给玩家。
 * @returns {Promise<{ok:boolean, code:string, message:string, models?:string[]}>}
 */
export async function testProvider(providerKey, { api_key, base_url } = {}) {
    const p = getProvider(providerKey);
    if (!p) return { ok: false, code: 'UNKNOWN_PROVIDER', message: `不认识的服务商「${providerKey}」。` };

    const saved = getProviderCredentials(p.key, p.key_name);
    let key = saved.api_key;
    if (typeof api_key === 'string' && api_key && api_key !== KEEP_SENTINEL && !api_key.includes('••')) {
        key = api_key.trim();
    }
    const url = typeof base_url === 'string' && base_url.trim() ? base_url.trim() : saved.base_url;

    if (p.key_name && !key) {
        return { ok: false, code: 'NO_KEY', message: '还没填密钥。请先粘贴 API 密钥再测试。' };
    }

    const ep = endpointFor(p, key, url);
    const t = withTimeout(15000);
    try {
        const res = await fetch(ep.url, { headers: ep.headers, signal: t.signal });
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }

        if (!res.ok) {
            const detail = (json?.error?.message || json?.message || text || '').slice(0, 200);
            if (res.status === 401 || res.status === 403) {
                return { ok: false, code: 'BAD_KEY', message: `密钥不被接受（${res.status}）。请确认是从「${p.label}」控制台复制的、没有多余空格。${detail ? '服务商说：' + detail : ''}` };
            }
            if (res.status === 404) {
                return { ok: false, code: 'BAD_URL', message: `接口地址不对（404）：${ep.url}。请检查「接口地址」这一栏。` };
            }
            if (res.status === 429) {
                return { ok: false, code: 'RATE_LIMIT', message: '请求太频繁或额度用完了，稍后再试。' };
            }
            return { ok: false, code: 'HTTP_' + res.status, message: `服务商返回错误 ${res.status}。${detail}` };
        }

        let models = [];
        try { models = (ep.pick(json) || []).filter(Boolean).map(String); } catch { models = []; }
        models.sort((a, b) => a.localeCompare(b));
        return {
            ok: true, code: 'OK',
            message: models.length
                ? `连接成功，可用模型 ${models.length} 个。`
                : '连接成功（这家服务商不提供模型列表，请手动填模型名）。',
            models,
        };
    } catch (err) {
        // ★Node 的全局 fetch 把真正的原因塞在 err.cause 里，自己的 message 恒为
        //   "fetch failed" —— 直接回给玩家等于什么都没说。必须往下扒一层。
        const cause = err?.cause;
        const msg = [err?.message, cause?.code, cause?.message, cause?.cause?.code]
            .filter(Boolean).map(String).join(' | ');
        if (err?.name === 'AbortError') {
            return { ok: false, code: 'TIMEOUT', message: '连接超时（15 秒）。境外服务商通常需要科学上网；国内服务商请检查网络。' };
        }
        if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
            return { ok: false, code: 'DNS', message: `找不到服务器地址。请检查「接口地址」是否写对，或网络是否正常。` };
        }
        if (/ECONNREFUSED/i.test(msg)) {
            return { ok: false, code: 'REFUSED', message: p.region === 'local'
                ? '本机服务没在跑。请先启动它，再回来测试。'
                : '连接被拒绝。请检查接口地址和网络。' };
        }
        if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(msg)) {
            return { ok: false, code: 'TLS', message: '安全连接失败。如果你在用代理软件，试试关掉后重试。' };
        }
        if (/ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
            return { ok: false, code: 'UNREACHABLE', message: p.region === 'intl'
                ? '连不上这家服务商。境外服务商通常需要科学上网，或者换一家国内服务商。'
                : '网络不通，请检查网络后重试。' };
        }
        return { ok: false, code: 'NETWORK', message: `连不上：${msg}` };
    } finally {
        t.done();
    }
}

/** GET /api/providers/:key/models */
export async function listModels(providerKey) {
    const r = await testProvider(providerKey, {});
    if (!r.ok) return { ok: false, code: r.code, error: r.message, models: [] };
    const p = getProvider(providerKey);
    const models = r.models && r.models.length ? r.models : (p?.models || []);
    return { ok: true, models };
}

export { KEYS_FILE };
export default { maskKey, panelView, configuredMap, saveProvider, testProvider, listModels, anyKeyReady, KEEP_SENTINEL };
