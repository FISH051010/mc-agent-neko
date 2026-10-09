// config_store.js — <home>/settings.json 覆盖层的读写。
//
// 分层：settings.js（随代码发行的默认值，用户不该编辑） < <home>/settings.json（面板写的差异）
//       < 环境变量 < 命令行。main.js 启动时把覆盖层盖到 settings 上。
//
// 这里**只存差异**：用户没动过的字段绝不写进 settings.json。这样以后升级版本、
// 默认值变了，用户能自动吃到新默认值，而不是被一份陈旧的全量快照钉死。
// （历史教训：settings_spec.json 的 default 与 settings.js 漂移了半年没人发现。）
//
// 另一条铁律：写入必须按下面这份「面向玩家的字段清单」校验。清单之外的键一律拒收 ——
// 面板是浏览器可达的接口，不能让任意 JSON 落进 settings 里被主进程 eval 式地吃掉。

import settingsDefaults from '../../../settings.js';
import { SETTINGS_FILE } from '../../utils/paths.js';
import { readJsonSafe, writeJsonBackup } from './fsx.js';

// type: string | number | boolean | select | stringlist
// restartRequired: 改完必须重启 bot 才生效
// danger: 面板上要给红色警示
export const FIELDS = [
    // ── 连接 ──────────────────────────────────────────────────────────────
    {
        key: 'host', type: 'string', group: '连接', restartRequired: true,
        label: '服务器地址',
        help: '你自己开的局域网世界填 localhost；连别人的服务器就填对方给的地址。',
    },
    {
        key: 'port', type: 'number', group: '连接', restartRequired: true,
        label: '服务器端口', min: -1, max: 65535,
        help: '在游戏里点「对局域网开放」后，聊天栏会显示一个端口号，把它填在这里。填 -1 表示自动搜索。',
    },
    {
        key: 'auth', type: 'select', group: '连接', restartRequired: true,
        label: '登录方式', options: ['offline', 'microsoft'],
        help: '自己开的单机/局域网世界选 offline；正版联机服务器选 microsoft。',
    },
    {
        key: 'minecraft_version', type: 'string', group: '连接', restartRequired: true,
        label: '游戏版本',
        help: '一般保持 auto 让它自己认。认错了再手动填，例如 1.21.8。',
    },
    {
        key: 'player_username', type: 'string', group: '连接', restartRequired: true,
        label: '主人的游戏 ID',
        help: 'bot 会把这个人当主人，跟随、听命令都认他。留空则自动认房主。',
    },

    // ── 聊天 ──────────────────────────────────────────────────────────────
    {
        key: 'chat_ingame', type: 'boolean', group: '聊天', restartRequired: true,
        label: '在游戏聊天里说话',
        help: '打开后 bot 的回复会发到游戏公屏，所有人都看得到。',
    },
    {
        key: 'chat_command_prefix', type: 'string', group: '聊天', restartRequired: true,
        label: '指令前缀',
        help: '在游戏里用这个词开头跟 bot 说话才算下命令，例如「@neko 去砍树」。注意不能用 / 开头 —— Minecraft 会把它当游戏命令拦掉，bot 收不到。留空表示所有话都当命令。',
    },
    {
        key: 'chat_whitelist', type: 'stringlist', group: '聊天', restartRequired: true,
        label: '允许指挥的玩家',
        help: '只有名单里的玩家说话 bot 才理。留空 = 谁都能指挥。',
    },
    {
        key: 'only_chat_with', type: 'stringlist', group: '聊天', restartRequired: true,
        label: '只跟这些人聊天',
        help: '留空 = 公开聊天。一般不用改。',
    },
    {
        key: 'language', type: 'string', group: '聊天', restartRequired: true,
        label: '聊天语言',
        help: '填 zh 让它说中文，填 en 说英文。',
    },
    {
        key: 'init_message', type: 'string', group: '聊天', restartRequired: true,
        label: '上线第一句话',
        help: 'bot 进入游戏后自动说的话。留空就不说。',
    },
    {
        key: 'speak', type: 'boolean', group: '聊天', restartRequired: true,
        label: '朗读出来',
        help: '打开后电脑会把 bot 的话念出来。',
    },
    {
        key: 'narrate_behavior', type: 'boolean', group: '聊天', restartRequired: true,
        label: '播报小动作',
        help: '像「捡起物品了」这种琐碎动作也说一声。嫌吵就关掉。',
    },
    {
        key: 'chat_bot_messages', type: 'boolean', group: '聊天', restartRequired: true,
        label: '公开机器人之间的对话',
        help: '多个 bot 互相说话时，是否也发到游戏公屏。',
    },

    // ── 行为 ──────────────────────────────────────────────────────────────
    {
        key: 'base_profile', type: 'select', group: '行为', restartRequired: true,
        label: '性格预设', options: ['survival', 'assistant', 'creative', 'god_mode'],
        help: 'survival=自己求生，assistant=听你指挥的助手，creative=创造模式建造，god_mode=无限制。',
    },
    {
        key: 'load_memory', type: 'boolean', group: '行为', restartRequired: true,
        label: '记住上次的事',
        help: '重启后接着上次的记忆继续。关掉则每次都从头开始。',
    },
    {
        key: 'allow_vision', type: 'boolean', group: '行为', restartRequired: true,
        label: '让 bot 看画面',
        help: '打开后 bot 能"看见"眼前的景象并据此判断。关掉会省钱但变笨。',
    },
    {
        key: 'render_bot_view', type: 'boolean', group: '行为', restartRequired: true,
        label: '在网页里看 bot 视角',
        help: '打开后可以在浏览器里实时看到 bot 眼中的画面（比较吃显卡）。',
    },
    {
        key: 'max_messages', type: 'number', group: '行为', restartRequired: true,
        label: '记住多少条对话', min: 1, max: 200,
        help: '数字越大 bot 记性越好，但每次思考也更贵更慢。',
    },
    {
        key: 'num_examples', type: 'number', group: '行为', restartRequired: true,
        label: '参考几个例子', min: 0, max: 20,
        help: '给 bot 看几个示范对话。一般不用改。',
    },
    {
        key: 'max_commands', type: 'number', group: '行为', restartRequired: true,
        label: '连续动作上限', min: -1, max: 1000,
        help: 'bot 一口气最多连做几个动作。-1 = 不限制。',
    },
    {
        key: 'show_command_syntax', type: 'select', group: '行为', restartRequired: true,
        label: '指令说明详细程度', options: ['full', 'shortened', 'none'],
        help: '给 bot 看的指令手册有多详细。模型不太聪明时用 full。',
    },
    {
        key: 'spawn_timeout', type: 'number', group: '行为', restartRequired: true,
        label: '进入游戏等待秒数', min: 5, max: 600,
        help: '连服务器很慢时把这个数调大。',
    },

    // ── 高级 ──────────────────────────────────────────────────────────────
    {
        key: 'allow_insecure_coding', type: 'boolean', group: '高级', restartRequired: true, danger: true,
        label: '允许 bot 自己写代码运行',
        help: '打开后 bot 能临时编写并运行程序来完成复杂任务，功能更强，但等于让 AI 在你电脑上执行代码。不确定就关掉。',
    },
    {
        key: 'code_timeout_mins', type: 'number', group: '高级', restartRequired: true,
        label: '代码最长运行分钟数', min: -1, max: 600,
        help: '-1 = 不限时。',
    },
    {
        key: 'block_place_delay', type: 'number', group: '高级', restartRequired: true,
        label: '放方块间隔（毫秒）', min: 0, max: 2000,
        help: '放得太快会被服务器的反作弊踢下线。被踢就把这个数调大。',
    },
    {
        key: 'mindserver_port', type: 'number', group: '高级', restartRequired: true, danger: true,
        label: '控制面板端口', min: 1, max: 65535,
        help: '改完要重启整个程序，而且下次要换成新端口才能打开这个页面。',
    },
    {
        key: 'auto_open_ui', type: 'boolean', group: '高级', restartRequired: true,
        label: '启动时自动打开控制面板',
        help: '开机跑起来后自动弹出浏览器页面。',
    },
    {
        key: 'log_all_prompts', type: 'boolean', group: '高级', restartRequired: true, danger: true,
        label: '记录全部对话到文件',
        help: '排查问题时才开。会写出很大的日志文件。',
    },
];

const BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

// ★settings.js 导出的是一个**单例对象**，main.js 会就地往上面盖覆盖层、环境变量和
//   命令行参数。如果这里直接读它当"默认值"，就会出现这种诡异 bug：
//     用户把服务器地址改成 1.2.3.4 → 存进 settings.json → 重启 → main.js 把它盖回
//     settings 单例 → 面板认为 1.2.3.4 就是"默认值" → 用户再点一次保存（值没变）→
//     被判定为"回到默认值"→ 从 settings.json 里删掉 → 下次重启地址又变回 localhost。
//   所以在模块加载的这一刻先深拷一份原始默认值。本模块是在 main.js 的 import 阶段
//   （通过 mindcraft → mindserver → panel/router）被求值的，早于 main.js 函数体里的
//   任何赋值，拿到的一定是 settings.js 里写死的那份。
const PRISTINE = JSON.parse(JSON.stringify(settingsDefaults));

function defaultOf(key) {
    const v = PRISTINE[key];
    return v === undefined ? null : v;
}

/** 读覆盖层原文（只含差异，可能为空对象）。 */
export function readOverlay() {
    const o = readJsonSafe(SETTINGS_FILE, {}) || {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
}

/** 默认值 + 覆盖层 = 当前生效值（只含清单内的键）。 */
export function effectiveValues() {
    const overlay = readOverlay();
    const out = {};
    for (const f of FIELDS) {
        out[f.key] = Object.prototype.hasOwnProperty.call(overlay, f.key)
            ? overlay[f.key]
            : defaultOf(f.key);
    }
    return out;
}

/** 面板要的完整视图。 */
export function describe() {
    const values = effectiveValues();
    return {
        fields: FIELDS.map(f => ({
            key: f.key, label: f.label, help: f.help, type: f.type,
            options: f.options || undefined,
            min: f.min, max: f.max,
            value: values[f.key], default: defaultOf(f.key),
            group: f.group, danger: !!f.danger,
            restartRequired: !!f.restartRequired,
        })),
        values,
    };
}

/** 单个字段的类型校验 + 归一化。抛出的 Error.message 是给玩家看的中文。 */
function coerce(field, raw) {
    switch (field.type) {
        case 'boolean': {
            if (typeof raw === 'boolean') return raw;
            if (raw === 'true' || raw === 1 || raw === '1') return true;
            if (raw === 'false' || raw === 0 || raw === '0') return false;
            throw new Error(`「${field.label}」只能是开或关。`);
        }
        case 'number': {
            const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (!Number.isFinite(n)) throw new Error(`「${field.label}」必须填数字。`);
            if (field.min !== undefined && n < field.min) throw new Error(`「${field.label}」不能小于 ${field.min}。`);
            if (field.max !== undefined && n > field.max) throw new Error(`「${field.label}」不能大于 ${field.max}。`);
            return n;
        }
        case 'select': {
            const s = String(raw ?? '');
            if (!field.options.includes(s)) {
                throw new Error(`「${field.label}」只能选：${field.options.join(' / ')}。`);
            }
            return s;
        }
        case 'stringlist': {
            let arr = raw;
            if (typeof raw === 'string') {
                arr = raw.split(/[,\s，]+/).map(s => s.trim()).filter(Boolean);
            }
            if (!Array.isArray(arr)) throw new Error(`「${field.label}」需要一个名单。`);
            return arr.map(s => String(s).trim()).filter(Boolean);
        }
        case 'string':
        default: {
            if (raw === null || raw === undefined) return '';
            if (typeof raw === 'object') throw new Error(`「${field.label}」只能填文字。`);
            return String(raw);
        }
    }
}

function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => String(v) === String(b[i]));
    }
    return a === b;
}

/**
 * 写入覆盖层。
 * @returns {{ok:true, changed:string[], restartRequired:boolean}}
 * @throws  {Error} 校验失败，message 是中文
 */
export function update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('提交的内容格式不对。');
    }
    const overlay = readOverlay();
    const changed = [];
    let restartRequired = false;

    for (const [key, raw] of Object.entries(patch)) {
        const field = BY_KEY[key];
        if (!field) throw new Error(`不认识的设置项「${key}」，已拒绝保存。`);
        const value = coerce(field, raw);
        const def = defaultOf(key);

        if (sameValue(value, def)) {
            // 回到默认值 → 从覆盖层里删掉，让它以后跟随默认值升级
            if (Object.prototype.hasOwnProperty.call(overlay, key)) {
                delete overlay[key];
                changed.push(key);
            }
        } else if (!sameValue(value, overlay[key])) {
            overlay[key] = value;
            changed.push(key);
        }
        if (changed.includes(key) && field.restartRequired) restartRequired = true;
    }

    if (changed.length > 0) writeJsonBackup(SETTINGS_FILE, overlay);
    return { changed, restartRequired };
}

/**
 * 拼一份可以直接喂给 Mindcraft.createAgent 的 settings。
 * 这里故意用**活的** settings 单例做底（不是上面那份 PRISTINE 快照）：main.js 已经
 * 把环境变量和命令行参数盖上去了，面板热启动 agent 时应当继承同一套值，
 * 否则从面板点「启动 Bot」和命令行启动会连到不同的服务器上。
 * 再盖一次覆盖层，保证面板刚改完的设置立刻生效、不用重启整个程序。
 */
export function launchSettings() {
    const merged = { ...settingsDefaults };
    for (const [k, v] of Object.entries(readOverlay())) {
        if (k.startsWith('_')) continue;
        merged[k] = v;
    }
    return merged;
}

export { SETTINGS_FILE };
export default { FIELDS, describe, update, effectiveValues, readOverlay, launchSettings, SETTINGS_FILE };
