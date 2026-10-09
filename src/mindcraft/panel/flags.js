// flags.js — 面向玩家的环境开关。
//
// 三层优先级（与 bootstrap.js loadEnvDefaults 完全一致，改这里必须同步改那边）：
//   app/env.defaults.json  <  <home>/runtime-flags.json  <  启动时已存在的环境变量
// 面板写的是中间那层。
//
// ★只暴露 flags_catalog.json 里列出的键。清单外的键一律拒收 —— 环境变量会原样
//   传给 agent 子进程，放任写入等于开了一个"任意 env 注入"的口子。
//
// ★改完必须重启 bot 才生效：这些值是子进程启动时读的，父进程改自己的环境变量
//   对已经跑着的子进程没有任何影响（历史上有人以为改完就生效，白等半小时）。
//
// 注：代码里写 globalThis.process 而不是裸 process，是为了对齐本仓 eslint.config.js
//     （它只装了 browser globals，裸 process 会报 no-undef）；mindserver.js 里也是这么写的。

import { fileURLToPath } from 'url';
import { appPath, homePath } from '../../utils/paths.js';
import { readJsonSafe, writeJsonBackup } from './fsx.js';

export const FLAGS_FILE = homePath('runtime-flags.json');
// 清单跟本文件同目录 —— 用 import.meta.url 定位，免得将来打包挪目录时 APP_ROOT 漂移
const CATALOG_FILE = fileURLToPath(new URL('./flags_catalog.json', import.meta.url));
const DEFAULTS_FILE = appPath('env.defaults.json');

function catalog() {
    const c = readJsonSafe(CATALOG_FILE, null);
    const list = c && Array.isArray(c.flags) ? c.flags : [];
    return list;
}

function byKey() {
    return Object.fromEntries(catalog().map(f => [f.key, f]));
}

function readOverrides() {
    const o = readJsonSafe(FLAGS_FILE, {}) || {};
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
}

function readPackDefaults() {
    const d = readJsonSafe(DEFAULTS_FILE, {}) || {};
    const out = {};
    for (const [k, v] of Object.entries(d)) {
        if (k.startsWith('_')) continue;      // env.defaults.json 里的 _comment_* 是注释
        out[k] = String(v);
    }
    return out;
}

/**
 * 当前值 + 它是从哪一层来的。
 * source: 'file'=用户在面板改过 | 'default'=随包默认值 | 'env'=启动时的环境变量 | 'builtin'=清单里的兜底
 */
function resolve(key, fallbackDefault) {
    const overrides = readOverrides();
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        return { value: String(overrides[key]), source: 'file' };
    }
    const packed = readPackDefaults();
    if (Object.prototype.hasOwnProperty.call(packed, key)) {
        return { value: packed[key], source: 'default' };
    }
    if (globalThis.process.env[key] !== undefined && globalThis.process.env[key] !== '') {
        return { value: String(globalThis.process.env[key]), source: 'env' };
    }
    return { value: String(fallbackDefault ?? ''), source: 'builtin' };
}

/** 展示用：把 "0"/"1" 翻成布尔，数字翻成数字。 */
function present(field, rawValue) {
    if (field.type === 'boolean') return rawValue === '1' || rawValue === 'true';
    if (field.type === 'number') {
        const n = Number(rawValue);
        return Number.isFinite(n) ? n : rawValue;
    }
    return rawValue;
}

export function describe() {
    const packed = readPackDefaults();
    return {
        flags: catalog().map(f => {
            const r = resolve(f.key, f.default);
            const packDefault = Object.prototype.hasOwnProperty.call(packed, f.key) ? packed[f.key] : String(f.default ?? '');
            return {
                key: f.key,
                label: f.label,
                help: f.help,
                group: f.group,
                type: f.type,
                options: f.options || undefined,
                min: f.min, max: f.max,
                value: present(f, r.value),
                default: present(f, packDefault),
                source: r.source,
                danger: !!f.danger,
            };
        }),
    };
}

/** 校验 + 归一化成 env 用的字符串。 */
function coerce(field, raw) {
    switch (field.type) {
        case 'boolean': {
            if (raw === true || raw === 1 || raw === '1' || raw === 'true') return '1';
            if (raw === false || raw === 0 || raw === '0' || raw === 'false') return '0';
            throw new Error(`「${field.label}」只能是开或关。`);
        }
        case 'number': {
            const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (!Number.isFinite(n)) throw new Error(`「${field.label}」必须填数字。`);
            if (field.min !== undefined && n < field.min) throw new Error(`「${field.label}」不能小于 ${field.min}。`);
            if (field.max !== undefined && n > field.max) throw new Error(`「${field.label}」不能大于 ${field.max}。`);
            return String(Math.round(n));
        }
        case 'select': {
            const s = String(raw ?? '');
            if (!Array.isArray(field.options) || !field.options.includes(s)) {
                throw new Error(`「${field.label}」只能选：${(field.options || []).join(' / ')}。`);
            }
            return s;
        }
        default:
            return String(raw ?? '');
    }
}

/**
 * 写入 runtime-flags.json。
 * @returns {{changed:string[], restartRequired:boolean}}
 * @throws  {Error} 中文 message
 */
export function update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('提交的内容格式不对。');
    }
    const fields = byKey();
    const overrides = readOverrides();
    const packed = readPackDefaults();
    const changed = [];

    for (const [key, raw] of Object.entries(patch)) {
        const field = fields[key];
        if (!field) throw new Error(`不认识的开关「${key}」，已拒绝保存。`);
        const value = coerce(field, raw);
        const packDefault = Object.prototype.hasOwnProperty.call(packed, key) ? packed[key] : String(field.default ?? '');

        if (value === packDefault) {
            // 回到随包默认值 → 从覆盖层删掉，以后跟随版本升级
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                delete overrides[key];
                changed.push(key);
            }
        } else if (overrides[key] !== value) {
            overrides[key] = value;
            changed.push(key);
        }
    }

    if (changed.length > 0) {
        writeJsonBackup(FLAGS_FILE, overrides);
        // 父进程也同步一份，这样面板里立刻能看到新值；但**已经跑着的 agent 子进程
        // 不受影响**，必须重启才生效，所以 restartRequired 恒为 true。
        for (const key of changed) {
            const v = resolve(key, fields[key]?.default);
            globalThis.process.env[key] = v.value;
        }
    }
    return { changed, restartRequired: true };
}

/** 起 agent 子进程时用的完整 env 覆盖（父进程 env 已经被 bootstrap 装好，这里只补差异）。 */
export function envOverrides() {
    const out = {};
    for (const [k, v] of Object.entries(readOverrides())) out[k] = String(v);
    return out;
}

export default { describe, update, envOverrides, FLAGS_FILE };
