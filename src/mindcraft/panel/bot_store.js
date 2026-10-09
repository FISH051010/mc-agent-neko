// bot_store.js — <home>/bot.json（bot 的人设/模型配置）的读写。
//
// bot.json 就是 mindcraft 的 profile 文件，main.js 找不到它才退而找 neko.json。
// profile 的真实形状是 prompter.js 定的：model / code_model / vision_model 三个字段
// 各自是 `{api, model, url, params}`（也接受裸字符串），缺的键会被 profiles/defaults
// 里的默认值补齐。面板不该把这些细节暴露给玩家，所以这里做一层翻译：
//
//   面板看到的                 →  bot.json 里真实写的
//   provider: 'deepseek'          model.api = 'deepseek'
//   model: 'deepseek-chat'        model.model = 'deepseek-chat'
//   （服务商的接口地址）           model.url = <providers.js 里的 base_url>
//   thinking: 'off'               顶层 thinking 字段（**只存意图，不存解析结果**）
//
// ★思考开关为什么只存意图：真正把它翻成各家请求参数的是 _model_map.createModel()，
//   那是全仓唯一的注入点，且带按模型的能力判定。面板这边再固化一份解析结果，会
//   permanently 压过运行时的正确值 —— 2026-09-07 的 'minimal' 事故就是这么来的，
//   详见下面 buildModelEntry() 的复盘注释。

import fs from 'fs';
import path from 'path';
import { homePath, dataPath, expandUserPath } from '../../utils/paths.js';
import { readJsonSafe, writeJsonBackup } from './fsx.js';
import { getProvider, listProviders } from '../../models/providers.js';

export const BOT_FILE = homePath('bot.json');
const LEGACY_FILE = homePath('neko.json');   // 老仓库/老包里的名字，做只读兜底

// provider(注册表 key) → _model_map.js 里真实存在的 api 前缀。
//
// 2026-08-07 交叉校验修正：这里原本有一张 NATIVE_API 表，把没有专属实现的国产
// provider 一律映射成 api='openai' + url=网关地址。那张表现在既过时又有害 ——
// _model_map.js 已经用工厂把 providers.js 里所有 openai_compatible 的 key 都注册成
// 了真实 api 前缀（glm/kimi/doubao/... 全部可直接构造，已实测 20/20 通过）。
// 继续走 api='openai' 会落到 gpt.js，而 gpt.js 取的是 OPENAI_API_KEY —— 用户在面板
// 里填的是「智谱」的密钥，于是启动必然报「缺少 API 密钥 OPENAI_API_KEY」。
// 现在直接用 provider key 当 api 前缀，密钥、stop 数组适配、stripThink 出口全部对齐。
function apiForProvider(providerKey) {
    return getProvider(providerKey) ? providerKey : 'openai';
}

export const THINKING_MODES = ['off', 'low', 'auto'];

const API_PREFIXES = new Set(listProviders().map(p => p.key));

/** api 前缀 → provider 注册表 key（读旧 profile 时反推用）。 */
function providerForApi(api, url) {
    if (!api) return '';
    // 新写法：api 本身就是 provider key
    if (getProvider(api)) {
        // 老 profile 里 api='openai' 但 url 指向国产网关的情况仍要靠 url 反查
        if (api === 'openai' && url) {
            const hit = listProviders().find(p => p.base_url && url.startsWith(p.base_url.replace(/\/+$/, '')));
            if (hit) return hit.key;
        }
        return api;
    }
    // 未知 api（手写 profile 用了注册表外的实现）——尽力靠 url 反查
    if (url) {
        const hit = listProviders().find(p => p.base_url && url.startsWith(p.base_url.replace(/\/+$/, '')));
        if (hit) return hit.key;
    }
    return '';
}

function modelNameOf(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') {
        // profile 里允许写 "openai/gpt-4o-mini" 这种带 api 前缀的形式，剥掉前缀
        const slash = entry.indexOf('/');
        if (slash > 0 && API_PREFIXES.has(entry.slice(0, slash))) return entry.slice(slash + 1);
        return entry;
    }
    if (typeof entry === 'object') return String(entry.model || '');
    return '';
}

function apiOf(entry) {
    if (!entry) return '';
    if (typeof entry === 'object') return String(entry.api || '');
    return '';
}

function urlOf(entry) {
    if (entry && typeof entry === 'object' && typeof entry.url === 'string') return entry.url;
    return '';
}

/** 读原始 profile JSON（bot.json 优先，其次 neko.json，都没有则空对象）。 */
export function readRaw() {
    const fromBot = readJsonSafe(BOT_FILE, null);
    if (fromBot && typeof fromBot === 'object') return fromBot;
    const legacy = readJsonSafe(LEGACY_FILE, null);
    if (legacy && typeof legacy === 'object') return legacy;
    return {};
}

/** 当前生效的 profile 文件路径（给 createAgent 用）。 */
export function profilePath() {
    if (fs.existsSync(BOT_FILE)) return BOT_FILE;
    if (fs.existsSync(LEGACY_FILE)) return LEGACY_FILE;
    return BOT_FILE;
}

export function botName() {
    const raw = readRaw();
    return String(raw.name || 'Bot');
}

/** 面板视图。 */
export function describe() {
    const raw = readRaw();
    const chat = raw.model;
    const provider = String(raw.provider || providerForApi(apiOf(chat), urlOf(chat)) || '');
    const skin = raw.skin && typeof raw.skin === 'object' ? raw.skin : {};
    return {
        name: String(raw.name || ''),
        provider,
        model: modelNameOf(chat),
        code_model: modelNameOf(raw.code_model),
        vision_model: modelNameOf(raw.vision_model),
        thinking: THINKING_MODES.includes(raw.thinking) ? raw.thinking : 'off',
        conversing: typeof raw.conversing === 'string' ? raw.conversing : '',
        skin: {
            file: String(skin.file || (skin.path ? path.basename(String(skin.path)) : '')),
            variant: skin.variant === 'slim' || skin.model === 'slim' ? 'slim' : 'classic',
            path: String(skin.path || ''),
        },
    };
}

/** 只由思考旋钮产生的 params 键。用来识别"以前被固化进 bot.json 的那份"。 */
const THINKING_PARAM_KEYS = new Set(['reasoning', 'reasoning_effort', 'thinking', 'enable_thinking', 'thinkingConfig', 'extra_body']);

/**
 * 把一个模型名 + provider + thinking 组装成 profile 里的模型条目。
 *
 * ★2026-09-07 事故复盘：这里原本会 `entry.params = resolveThinking(...)`，把**解析后的**
 *   思考参数固化进 bot.json。两个问题：
 *     1. 纯冗余 —— _model_map.createModel() 才是全仓唯一的注入点，它会在运行时按
 *        profile 顶层的 thinking 现算（prompter.js:77 负责把顶层值下发到各模型条目），
 *        而且还带按模型的能力判定（openaiReasoningCapable 之类）。
 *     2. 更糟：createModel 的注入是"用户手写的 params 优先"，固化值正好长得像手写的，
 *        于是**永久压过**运行时的正确值。注册表事后修好了，老用户的 bot.json 照旧坏。
 *   实录：注册表把 OpenAI 的关思考写成 effort:'minimal'，被固化进 bot.json；用户的
 *   gpt-5.6-terra 不支持 'minimal' → 每次调用 400 → "My brain disconnected" → "I'm stuck"。
 *
 *   所以现在只存**意图**（顶层 thinking: 'off'），不存解析结果。
 */
function buildModelEntry(providerKey, modelName, thinking, prevEntry) {
    if (!modelName) return null;
    const p = getProvider(providerKey);
    const entry = { api: apiForProvider(providerKey), model: String(modelName) };
    const url = p && p.base_url ? p.base_url : '';
    if (url) entry.url = url;

    // 保留用户自己写的 params（temperature 之类），但把历史遗留的思考参数剔掉 ——
    // 留着它就会继续压过运行时注入。thinking 仍由顶层字段表达，不会因此丢失。
    const prev = prevEntry && typeof prevEntry === 'object' ? prevEntry.params : null;
    if (prev && typeof prev === 'object') {
        const kept = {};
        for (const [k, v] of Object.entries(prev)) {
            if (!THINKING_PARAM_KEYS.has(k)) kept[k] = v;
        }
        if (Object.keys(kept).length) entry.params = kept;
    }
    return entry;
}

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

/**
 * 写入 bot.json。只处理传进来的字段，其余保持原样。
 * @returns {{changed:string[], restartRequired:boolean, renamedFrom?:string}}
 * @throws  {Error} 中文 message
 */
export function update(patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('提交的内容格式不对。');
    }
    const raw = readRaw();
    const before = describe();
    const changed = [];
    let renamedFrom = null;

    // ── 名字 ──
    if (patch.name !== undefined) {
        const name = String(patch.name).trim();
        if (!NAME_RE.test(name)) {
            throw new Error('名字只能用英文字母、数字和下划线，最多 16 个字符（Minecraft 的限制）。');
        }
        if (name !== before.name) {
            renamedFrom = before.name;
            raw.name = name;
            changed.push('name');
        }
    }

    // ── provider / thinking / 三个模型 ──
    let provider = before.provider;
    if (patch.provider !== undefined) {
        const pk = String(patch.provider).trim();
        if (pk && !getProvider(pk)) throw new Error(`不认识的服务商「${pk}」。`);
        if (pk !== provider) changed.push('provider');
        provider = pk;
        raw.provider = pk;
    }

    let thinking = before.thinking;
    if (patch.thinking !== undefined) {
        const t = String(patch.thinking).trim() || 'off';
        if (!THINKING_MODES.includes(t)) {
            throw new Error('思考模式只能是 off（关，推荐）、low（少量）或 auto（随模型）。');
        }
        if (t !== thinking) changed.push('thinking');
        thinking = t;
        raw.thinking = t;
    }

    const modelFields = [
        ['model', 'model'],
        ['code_model', 'code_model'],
        ['vision_model', 'vision_model'],
    ];
    const providerOrThinkingChanged = changed.includes('provider') || changed.includes('thinking');

    for (const [field] of modelFields) {
        const given = patch[field];
        const hasGiven = given !== undefined;
        if (!hasGiven && !providerOrThinkingChanged) continue;

        const name = hasGiven ? String(given ?? '').trim() : before[field];
        if (!name) {
            if (raw[field] !== undefined) { delete raw[field]; changed.push(field); }
            continue;
        }
        if (!provider) throw new Error('请先选一个服务商，再填模型名。');
        const entry = buildModelEntry(provider, name, thinking, raw[field]);
        const prev = JSON.stringify(raw[field] ?? null);
        raw[field] = entry;
        if (JSON.stringify(entry) !== prev && !changed.includes(field)) changed.push(field);
    }

    // ── 人设提示词 ──
    if (patch.conversing !== undefined) {
        const c = patch.conversing === null ? '' : String(patch.conversing);
        if (c.length > 60000) throw new Error('人设文字太长了（超过 6 万字），请精简一些。');
        if (!c.trim()) {
            if (raw.conversing !== undefined) { delete raw.conversing; changed.push('conversing'); }
        } else if (c !== before.conversing) {
            raw.conversing = c;
            changed.push('conversing');
        }
    }

    // ── 皮肤（也可以走 skins.js 的接口，这里接受直接传入）──
    if (patch.skin !== undefined && patch.skin && typeof patch.skin === 'object') {
        const applied = applySkinToRaw(raw, patch.skin.file, patch.skin.variant);
        if (applied) changed.push('skin');
    }

    if (changed.length > 0) writeJsonBackup(BOT_FILE, raw);
    if (renamedFrom) migrateBotDataDir(renamedFrom, raw.name);

    return { changed, restartRequired: changed.length > 0, renamedFrom };
}

/**
 * 把皮肤写进 profile。
 * ★FabricTailor 是在 **Minecraft 服务端**解析这个路径的（agent.js 发的是
 *   `/skin set upload <variant> <路径>`），所以这里必须写展开后的绝对路径，
 *   写相对路径服务端找不到文件，皮肤会静默不生效。
 */
function applySkinToRaw(raw, file, variant) {
    const v = variant === 'slim' ? 'slim' : 'classic';
    if (!file) {
        if (raw.skin === undefined) return false;
        delete raw.skin;
        return true;
    }
    const abs = expandUserPath(path.join('skins', String(file)));
    const next = {
        // model 是 FabricTailor 认的字段名，variant 是面板自己的叫法，两个都写上
        model: v, variant: v,
        file: String(file),
        path: abs.replace(/\\/g, '/'),   // 走聊天栏发给服务端，正斜杠更稳
    };
    const prev = JSON.stringify(raw.skin ?? null);
    raw.skin = next;
    return JSON.stringify(next) !== prev;
}

/** 供 skins.js 调用：只改皮肤。 */
export function setSkin(file, variant) {
    const raw = readRaw();
    const changed = applySkinToRaw(raw, file, variant);
    if (changed) writeJsonBackup(BOT_FILE, raw);
    return { changed, restartRequired: true };
}

/** 当前选中的皮肤文件名（没有则 null）。 */
export function currentSkin() {
    const raw = readRaw();
    const s = raw.skin;
    if (!s || typeof s !== 'object') return null;
    if (s.file) return String(s.file);
    if (s.path) return path.basename(String(s.path));
    return null;
}

/**
 * 改名后把运行时状态目录一起搬过去。
 * bots/<名字>/ 下面是记忆、技能缓存、事件日志 —— 不搬的话用户一改名就"失忆"，
 * 而且旧目录会永远留在那里没人清。
 */
function migrateBotDataDir(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    const from = dataPath('bots', oldName);
    const to = dataPath('bots', newName);
    try {
        if (!fs.existsSync(from)) return;
        if (fs.existsSync(to)) {
            console.warn(`[panel] ${to} 已存在，跳过改名搬迁（旧数据仍在 ${from}）。`);
            return;
        }
        fs.renameSync(from, to);
        console.log(`[panel] bot 数据目录已搬迁: ${from} → ${to}`);
    } catch (err) {
        // 搬不动不该让改名失败 —— 大不了从空记忆开始
        console.warn(`[panel] bot 数据目录搬迁失败（不影响改名）: ${err.message}`);
    }
}

/** 读出可直接喂给 createAgent 的 profile 对象。 */
export function loadProfile() {
    const raw = readRaw();
    return JSON.parse(JSON.stringify(raw));
}

export default { BOT_FILE, describe, update, setSkin, currentSkin, readRaw, loadProfile, profilePath, botName, THINKING_MODES };
