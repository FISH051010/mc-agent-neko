// migrate.js — 用户数据的就地升级。
//
// 分发包升级时，`app/` 会被换成新版，但**用户层的文件是保留的**（bot.json / keys.json /
// settings.json 是用户数据，覆盖掉等于把人家配置删了）。所以任何"写进用户文件里的
// 错误值"，光改代码是救不回来的 —— 必须在启动时就地修一遍。
//
// 这里的每条迁移都必须：幂等、失败不致命（迁移挂了不能让程序起不来）、只在真的改了
// 东西时才落盘并打一行中文说明。

import fs from 'fs';
import { readJsonSafe, writeJsonAtomic } from './bootstrap.js';

/**
 * 只由「思考开关」产生的 params 键。
 * 这些不该出现在 bot.json 里 —— 真正的翻译发生在 _model_map.createModel() 运行时。
 */
const THINKING_PARAM_KEYS = ['reasoning', 'reasoning_effort', 'thinking', 'enable_thinking', 'thinkingConfig', 'extra_body'];

// 随包默认提示词的历次修正。老用户的 bot.json 不会被升级覆盖（见下方 PROMPT_PATCHES 的用法说明），
// 只能在迁移里就地替换。加新条目时：from 写被替换掉的原句、to 写新句，两者都要够独特。
const PROMPT_PATCHES = [
    {
        // ★2026-09-10 用户令：「除非被显式要求，不要自行考虑进食的问题」。
        //   原句只说"自动进食"，LLM 仍会主动提饿、主动去做饭找吃的，白白岔开任务。
        id: 'no-self-initiated-eating',
        from: 'Eating food you already carry is automatic, and running low is acceptable;',
        to: 'Unless you are EXPLICITLY told to eat, cook, or gather food, do not concern yourself with '
            + 'eating at all: never issue an eat/cook/hunt-for-food command on your own initiative, and '
            + 'never mention hunger as a reason to pause or change plans. Eating what you already carry '
            + 'is handled automatically outside your control, and running low is acceptable;',
        note: '进食不再由 bot 自行发起（除非你明确要求）',
    },
];

/** 从被固化的 params 里反推用户当初的意图（off / low），推不出来按 off。 */
function inferThinkingMode(params) {
    if (!params || typeof params !== 'object') return null;

    const eff = params.reasoning_effort
        ?? (params.reasoning && typeof params.reasoning === 'object' ? params.reasoning.effort : undefined);
    if (typeof eff === 'string') return (eff === 'none' || eff === 'minimal') ? 'off' : 'low';

    if (params.enable_thinking === false) return 'off';
    if (params.enable_thinking === true) return 'low';

    if (params.thinking && typeof params.thinking === 'object') {
        return params.thinking.type === 'disabled' ? 'off' : 'low';
    }
    if (params.thinkingConfig && typeof params.thinkingConfig === 'object') {
        return Number(params.thinkingConfig.thinkingBudget) === 0 ? 'off' : 'low';
    }
    const g = params.extra_body?.google?.thinking_config;
    if (g) return Number(g.thinking_budget) === 0 ? 'off' : 'low';

    return null;
}

/**
 * bot.json 迁移：剥掉被固化进模型条目的思考参数。
 *
 * ★2026-09-07 事故：v0.2.0 的控制面板会把 resolveThinking() 的**解析结果**写进
 *   bot.json 的 model.params。而注册表当时把 OpenAI 的"关思考"写成了
 *   `reasoning.effort = 'minimal'` —— gpt-5.6-* 根本不认这个档位（它要 'none'），
 *   于是每次 LLM 调用都 400，被吞成 "My brain disconnected, try again."，
 *   bot 表现为没脑子 + 反复 "I'm stuck!"。
 *
 *   代码侧已经改好（注册表值修正 + 运行时按报错自愈 + 面板不再固化），但**老用户
 *   的 bot.json 里那份坏值会一直留着**，而且它优先级高于运行时注入（createModel 的
 *   规则是"用户手写的 params 优先"），会永久压过修复。所以必须在这里剥掉。
 *
 *   剥掉不会丢失用户意图：思考开关本来就有顶层 `thinking` 字段表达，这里顺便把
 *   缺失的顶层值从被剥掉的参数里反推补上。
 *
 * @param {string} file bot.json 路径
 * @returns {string[]} 人类可读的改动说明（空数组 = 什么都没改）
 */
export function migrateProfile(file) {
    const notes = [];
    let raw;
    try {
        raw = readJsonSafe(file, null);
    } catch {
        return notes;
    }
    if (!raw || typeof raw !== 'object') return notes;

    let dirty = false;
    let inferred = null;

    for (const field of ['model', 'code_model', 'vision_model']) {
        const entry = raw[field];
        if (!entry || typeof entry !== 'object' || !entry.params || typeof entry.params !== 'object') continue;

        const dropped = THINKING_PARAM_KEYS.filter(k => entry.params[k] !== undefined);
        if (dropped.length === 0) continue;

        if (!inferred) inferred = inferThinkingMode(entry.params);

        for (const k of dropped) delete entry.params[k];
        if (Object.keys(entry.params).length === 0) delete entry.params;

        dirty = true;
        notes.push(`${field}: 移除了写死的思考参数 ${dropped.join('/')}`);
    }

    // 顶层 thinking 才是意图的存放处；缺了就按刚才反推出来的补上
    if (dirty && raw.thinking === undefined) {
        raw.thinking = inferred || 'off';
        notes.push(`补上顶层 thinking = "${raw.thinking}"`);
    }

    // ── 提示词就地补丁 ────────────────────────────────────────────────────────────
    // bot.json 的 conversing 是**用户层**文件：升级只换 app\，用户层纹丝不动（这是刻意的，
    // 不然覆盖解压会把用户改的人设/名字全盖掉）。代价是随包默认提示词的修正到不了老用户手上。
    // 所以提示词的每一次修正都要在这里补一条：锚点是被替换掉的原句，命中才改，改完幂等。
    // 锚点选**尽量短的独特句子**，避开换行与格式，用户在别处的自定义就不会被误伤。
    for (const patch of PROMPT_PATCHES) {
        for (const field of ['conversing', 'coding', 'saving_memory']) {
            const cur = raw[field];
            if (typeof cur !== 'string') continue;
            if (cur.includes(patch.to)) continue;          // 已经是新版
            if (!cur.includes(patch.from)) continue;       // 用户自己改过 / 不适用
            raw[field] = cur.replace(patch.from, patch.to);
            dirty = true;
            notes.push(`${field}: ${patch.note}`);
        }
    }

    if (!dirty) return notes;

    try {
        // 改用户文件之前先留一份 .bak，出问题能人工回滚
        try { fs.copyFileSync(file, `${file}.bak`); } catch { /* 备份失败不挡迁移 */ }
        writeJsonAtomic(file, raw);
    } catch (err) {
        console.error(`[migrate] 写回 ${file} 失败: ${err.message}（不影响本次启动，运行时会自动纠正思考档位）`);
        return [];
    }
    return notes;
}

/**
 * settings.json 迁移：把以 "/" 开头的游戏内指令前缀改掉。
 *
 * ★2026-09-09 用户实测：Minecraft 客户端会把 "/" 开头的输入当成**游戏内置命令**拦下来，
 *   消息压根不会进聊天频道 —— bot 连一条 chat 事件都收不到。而历史默认值恰恰是 "/neko"，
 *   等于游戏内指令通道从来就没通过。表现极具迷惑性：在游戏里怎么喊都没反应，日志里也
 *   没有任何"收到消息"的痕迹，看起来像 bot 傻了，实际是消息根本没发出来。
 *
 *   代码里的默认值已改成 "@neko"，但老用户的 <home>/settings.json 里存着旧值，
 *   改默认值救不了他们 —— 必须在这里就地改写。只动 "/" 开头的，用户自己设的别的前缀不碰。
 *
 * @param {string} file settings.json 路径
 * @returns {string[]} 人类可读的改动说明
 */
export function migrateSettings(file) {
    const notes = [];
    const raw = readJsonSafe(file, null);
    if (!raw || typeof raw !== 'object') return notes;

    let dirty = false;

    const cur = raw.chat_command_prefix;
    if (typeof cur === 'string' && cur.startsWith('/')) {
        const next = '@' + cur.slice(1);      // /neko → @neko，保留用户自定义的词
        raw.chat_command_prefix = next;
        notes.push(`游戏内指令前缀 "${cur}" → "${next}"（"/" 开头会被 Minecraft 当成游戏命令吞掉，bot 收不到）`);
        dirty = true;
    }

    // ★2026-09-09: 旧默认值 only_chat_with:["admin"] 是开发机遗留 —— 它让 bot **只听一个叫
    //   admin 的玩家**（agent.js:121），玩家的真实 ID 当然不叫 admin，于是在游戏里怎么说都
    //   没反应；回复也只 whisper 给不存在的 "admin"。绝大多数用户是从 settings.js 拿到这个
    //   默认值的（不会落进 settings.json），但万一有人在面板里存过，这里一并清掉。
    //   只认 ["admin"] 这一个字面值 —— 用户自己设的名单不碰。
    const ocw = raw.only_chat_with;
    if (Array.isArray(ocw) && ocw.length === 1 && ocw[0] === 'admin') {
        raw.only_chat_with = [];
        notes.push('只听 "admin" 的限制已解除（那是开发机遗留值，会让 bot 听不见你在游戏里说话）');
        dirty = true;
    }

    if (!dirty) return notes;

    try {
        try { fs.copyFileSync(file, `${file}.bak`); } catch { /* 备份失败不挡迁移 */ }
        writeJsonAtomic(file, raw);
    } catch (err) {
        console.error(`[migrate] 写回 ${file} 失败: ${err.message}`);
        return [];
    }
    return notes;
}

/**
 * 跑全部迁移。启动时调用一次，失败绝不阻塞启动。
 * @param {{profile?: string, settings?: string, preNotes?: string[]}} paths
 */
export function runMigrations({ profile, settings, preNotes } = {}) {
    const all = Array.isArray(preNotes) ? [...preNotes] : [];
    try {
        if (profile) all.push(...migrateProfile(profile));
        if (settings) all.push(...migrateSettings(settings));
    } catch (err) {
        console.error(`[migrate] 迁移过程出错，已跳过: ${err.message}`);
        return;
    }
    if (all.length) {
        console.log('已自动升级你的配置文件：');
        for (const n of all) console.log(`  · ${n}`);
        console.log('（原文件已备份为同名 .bak）\n');
    }
}

export default { runMigrations, migrateProfile, migrateSettings };
