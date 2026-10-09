// keys.js — API 密钥的唯一读写口。
//
// 2026-08-07 重写要点：
//   · 路径不再是裸的 './keys.json' (纯 CWD 相对、无任何覆盖通道)，改走 paths.js 的
//     KEYS_FILE。分发包里 CWD 和代码目录不是同一层，旧写法能生效纯属 bat 的巧合。
//   · BOM-safe。PS 写出来的 JSON 带 BOM 会让 JSON.parse 直接抛，历史上造成过静默死局。
//   · 新增 providers 嵌套块：每个 provider 一个 api_key + 可选 base_url，供控制面板 GUI 写入。
//     扁平的 XXX_API_KEY 写法完全向后兼容，旧 keys.json 不用改。
//   · 密钥由控制面板配置，文件缺失/为空不再是错误。
//
// keys.json 形态（两种并存，providers 优先）：
// {
//   "providers": { "deepseek": { "api_key": "sk-...", "base_url": "" } },
//   "OPENAI_API_KEY": "sk-..."
// }

import fs from 'fs';
import path from 'path';
import { KEYS_FILE } from './paths.js';
import { listProviders, getProvider, inferProviderKey, needsNoKey } from '../models/providers.js';

let keys = {};
let providers = {};

// key_name → provider key 的反查表（DEEPSEEK_API_KEY → deepseek）。
// 用途见下面 getKey() 的注释。providers.js 是纯静态数据、无任何 import，不会成环。
const KEY_NAME_TO_PROVIDER = (() => {
    const m = {};
    for (const p of listProviders()) if (p.key_name) m[p.key_name] = p.key;
    return m;
})();

function parseKeysFile() {
    keys = {};
    providers = {};
    let raw;
    try {
        raw = fs.readFileSync(KEYS_FILE, 'utf8');
    } catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.error(`读取 ${KEYS_FILE} 失败: ${err.message}`);
        }
        return;
    }
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    if (!raw.trim()) return;
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        // 绝不静默：格式坏掉时用户会以为"我明明填了 key"
        console.error(`keys.json 格式错误（${err.message}）—— 请在控制面板重新保存一次密钥。`);
        return;
    }
    if (!data || typeof data !== 'object') return;
    for (const [k, v] of Object.entries(data)) {
        if (k === 'providers') continue;
        if (typeof v === 'string') keys[k] = v;
    }
    if (data.providers && typeof data.providers === 'object') {
        for (const [k, v] of Object.entries(data.providers)) {
            if (!v || typeof v !== 'object') continue;
            providers[k] = {
                api_key: typeof v.api_key === 'string' ? v.api_key : '',
                base_url: typeof v.base_url === 'string' ? v.base_url : '',
            };
        }
    }
}

parseKeysFile();

/** 面板写完 keys.json 后调用，无需重启主进程即可生效。 */
export function reloadKeys() {
    parseKeysFile();
    return { flat: Object.keys(keys).length, providers: Object.keys(providers).length };
}

// 2026-08-07 交叉校验补丁：控制面板把密钥写进 providers.<key>.api_key，而手写的
// 模型类 (gpt.js / claude.js / gemini.js / deepseek.js / qwen.js / grok.js ...) 至今
// 仍按扁平名取 getKey('OPENAI_API_KEY')。两边不通 → 面板里填好密钥、点启动，agent
// 仍然抛「缺少 API 密钥」。这里补一条反查兜底，把 providers 块也纳入查找链：
//     keys[name] → process.env[name] → providers[反查到的 provider].api_key
// 只加兜底、不动任何模型类，也不改 getProviderCredentials 的既有语义。
function lookupKey(name) {
    if (keys[name]) return keys[name];
    if (process.env[name]) return process.env[name];
    const pk = KEY_NAME_TO_PROVIDER[name];
    if (pk && providers[pk] && providers[pk].api_key) return providers[pk].api_key;
    return '';
}

export function getKey(name) {
    const key = lookupKey(name);
    if (!key) {
        throw new Error(`缺少 API 密钥 "${name}" —— 请打开控制面板（浏览器访问 mindserver 地址）在「API 配置」页填写。`);
    }
    return key;
}

export function hasKey(name) {
    return !!lookupKey(name);
}

/**
 * 取某个 provider 的凭据。查找顺序：
 *   providers[key] → 扁平字段 (provider 注册表声明的 key_name) → 同名环境变量
 * 返回 { api_key, base_url }；未配置时 api_key 为 ''。
 */
export function getProviderCredentials(providerKey, keyName) {
    const p = providers[providerKey] || {};
    let api_key = p.api_key || '';
    if (!api_key && keyName) api_key = keys[keyName] || process.env[keyName] || '';
    return { api_key, base_url: p.base_url || '' };
}

export function hasProviderKey(providerKey, keyName) {
    return !!getProviderCredentials(providerKey, keyName).api_key;
}

/**
 * bot 当前这份 profile 用到的供应商，密钥齐了没有。
 *
 * ★ 这是「能不能开跑」的**唯一**判据，别再用「全局有没有配过任何密钥」那种问法 ——
 *   本地模型（Ollama / LM Studio）压根不需要密钥，全局问法永远答 false，
 *   面板就会一直挂着「还没配置 AI 密钥」，用户以为本地模型用不了。（2026-09-07 用户反馈）
 *   反过来，配了 DeepSeek 却把 profile 指向 OpenAI，全局问法答 true，
 *   然后 agent 在 getKey 处硬崩 —— 两个方向都错。
 *
 * @param {object} profileJson  bot.json 的内容
 * @returns {{ready:boolean, chosen:boolean, missing:Array<{provider:string,label:string}>}}
 *          chosen=false 表示还没选供应商（model 字段为空）
 */
export function profileKeyStatus(profileJson) {
    const fields = [profileJson?.model, profileJson?.code_model, profileJson?.vision_model].filter(Boolean);
    if (fields.length === 0) return { ready: false, chosen: false, missing: [] };

    const missing = [];
    const seen = new Set();
    for (const f of fields) {
        const pk = inferProviderKey(f);
        if (!pk || seen.has(pk)) continue;
        seen.add(pk);
        const p = getProvider(pk);
        if (!p) continue;
        if (needsNoKey(pk)) continue;                       // 本机模型：无需密钥
        if (hasProviderKey(pk, p.key_name)) continue;
        missing.push({ provider: pk, label: p.label });
    }
    return { ready: missing.length === 0, chosen: seen.size > 0, missing };
}

/** 全局：配过任何一个需要密钥的供应商没有。只用于「首次运行」这类粗粒度提示，不要当启动闸。 */
export function anyKeyConfigured() {
    if (listConfiguredProviders().length > 0) return true;
    return listProviders().some(p => p.key_name && hasKey(p.key_name));
}

/** 已配置密钥的 provider 内部 key 列表（面板用）。 */
export function listConfiguredProviders() {
    return Object.entries(providers).filter(([, v]) => v.api_key).map(([k]) => k);
}

/** 面板写入。传 api_key === undefined 表示保留原值（掩码回传语义）。 */
export function setProviderCredentials(providerKey, { api_key, base_url } = {}) {
    const cur = providers[providerKey] || { api_key: '', base_url: '' };
    const next = {
        api_key: api_key === undefined ? cur.api_key : String(api_key || ''),
        base_url: base_url === undefined ? cur.base_url : String(base_url || ''),
    };
    let onDisk = {};
    try {
        let raw = fs.readFileSync(KEYS_FILE, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        onDisk = raw.trim() ? JSON.parse(raw) : {};
    } catch { /* 文件不存在或坏了 —— 重建 */ }
    if (!onDisk || typeof onDisk !== 'object') onDisk = {};
    if (!onDisk.providers || typeof onDisk.providers !== 'object') onDisk.providers = {};
    if (!next.api_key && !next.base_url) delete onDisk.providers[providerKey];
    else onDisk.providers[providerKey] = next;

    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    const tmp = `${KEYS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 4), 'utf8');
    fs.renameSync(tmp, KEYS_FILE);
    // 密钥文件权限收紧（Windows 上是 no-op，但 WSL/Linux 下有意义）
    try { fs.chmodSync(KEYS_FILE, 0o600); } catch { /* ignore */ }
    parseKeysFile();
    return next;
}

export { KEYS_FILE };
