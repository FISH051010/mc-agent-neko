// bootstrap.js — 进程启动的第一件事。必须是 main.js / init_agent.js 的**第一条 import**。
//
// 职责 (全部幂等，可重复 import)：
//   1. 建齐运行时目录，杜绝历史上"缺目录 → append 落进 catch → 静默丢日志"的坑
//   2. 装载 env 默认值 (app/env.defaults.json) + 面板覆盖层 (<home>/runtime-flags.json)
//   3. keys.json 缺失时创建空壳 —— 密钥由控制面板 GUI 配置，用户不需要手动填文件
//   4. process.chdir(HOME_DIR) —— 兜底网：任何还没迁移到 dataPath() 的裸相对路径
//      (`./bots/...`) 也会落到正确的地方，而不是分发包的代码目录里
//
// 为什么 chdir 是安全的：代码资产的读取 (技能、execTemplate、profiles/defaults、
// npc/construction) 全部走 appPath()/__dirname，与 CWD 无关；CWD 只服务于运行时状态。

import fs from 'fs';
import path from 'path';
import { APP_ROOT, HOME_DIR, appPath, homePath, dataPath, KEYS_FILE } from './paths.js';

const FLAGS_FILE = homePath('runtime-flags.json');

/** BOM-safe JSON 读取。PS 写的 JSON 常带 UTF-8 BOM，JSON.parse 会直接抛。 */
export function readJsonSafe(file, fallback = null) {
    try {
        let raw = fs.readFileSync(file, 'utf8');
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        if (!raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (err) {
        if (err && err.code === 'ENOENT') return fallback;
        console.error(`[bootstrap] 读取 ${file} 失败: ${err.message}`);
        return fallback;
    }
}

/** 原子写：先写 .tmp 再 rename，避免半截文件。 */
export function writeJsonAtomic(file, obj) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 4), 'utf8');
    fs.renameSync(tmp, file);
}

function ensureDirs() {
    for (const d of [
        dataPath('bots'),
        dataPath('bots', '_supervisor'),
        homePath('skins'),
    ]) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (err) {
            console.error(`[bootstrap] 无法创建目录 ${d}: ${err.message}`);
        }
    }
}

function ensureKeysFile() {
    if (fs.existsSync(KEYS_FILE)) return;
    // 密钥走面板 GUI 配置，这里只放一个空壳让面板有东西可写。
    try {
        writeJsonAtomic(KEYS_FILE, { providers: {} });
        console.log(`[bootstrap] 已创建 ${KEYS_FILE}（请在控制面板里配置 API 密钥）`);
    } catch (err) {
        console.error(`[bootstrap] 无法创建 keys.json: ${err.message}`);
    }
}

/**
 * 从 app/defaults/ 播种用户层配置 —— **只在文件不存在时**。
 *
 * ★为什么默认值不直接打在包根：升级分发包的自然做法就是「把新 zip 解压覆盖到原目录」。
 *   如果 bot.json / settings.json 随包躺在包根，这一下就会把用户的 bot 名字、人设、
 *   选好的模型、以及那个每次开局域网都要改的端口**全部盖回出厂值** —— 用户会以为
 *   新版把配置搞丢了。放进 app/defaults/ 当种子，覆盖解压只换 app/，用户层纹丝不动。
 *
 *   老包（把文件打在包根的那版）升级上来也没事：文件已存在 → 这里直接跳过。
 */
function seedUserFiles() {
    for (const name of ['bot.json', 'settings.json']) {
        const dst = homePath(name);
        if (fs.existsSync(dst)) continue;              // 用户已有 —— 绝不覆盖
        const seed = appPath('defaults', name);
        if (!fs.existsSync(seed)) continue;            // 开发态没有 defaults/，跳过
        try {
            fs.copyFileSync(seed, dst);
            console.log(`[bootstrap] 已生成 ${name}（首次运行，取自随包默认值）`);
        } catch (err) {
            console.error(`[bootstrap] 生成 ${name} 失败: ${err.message}`);
        }
    }
}

/**
 * env 优先级：app/env.defaults.json  <  <home>/runtime-flags.json  <  已存在的 process.env
 * 即：只填空，绝不覆盖调用方显式设置的环境变量。
 */
function loadEnvDefaults() {
    const defaults = readJsonSafe(appPath('env.defaults.json'), {}) || {};
    const overrides = readJsonSafe(FLAGS_FILE, {}) || {};
    const merged = { ...defaults, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
        if (v === null || v === undefined) continue;
        if (process.env[k] !== undefined && process.env[k] !== '') continue;
        process.env[k] = String(v);
    }
}

let done = false;
export function bootstrap() {
    if (done) return { APP_ROOT, HOME_DIR };
    done = true;

    ensureDirs();
    loadEnvDefaults();
    seedUserFiles();
    ensureKeysFile();

    try {
        if (path.resolve(process.cwd()) !== path.resolve(HOME_DIR)) process.chdir(HOME_DIR);
    } catch (err) {
        console.error(`[bootstrap] chdir(${HOME_DIR}) 失败: ${err.message}`);
    }

    return { APP_ROOT, HOME_DIR };
}

bootstrap();

export default { bootstrap, readJsonSafe, writeJsonAtomic, FLAGS_FILE };
