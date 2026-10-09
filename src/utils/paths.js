// paths.js — 全仓唯一的路径基准。
//
// 背景 (2026-08-07): 分发 zip 的布局是 `<包根>/app/<代码>`，bat 里 CWD = 包根，
// 于是 `process.cwd()` 族与 `import.meta.url` 族解析到两个不同目录。历史上
// v0.1.2 就栽在这上面 —— skill_library.js 用 `process.cwd()/bots/_supervisor/skills`
// 找技能，而打包时 bots/ 被复制进了 src/，结果分发出去的包里 63 个热加载技能
// 一个都加载不了 (customSkill 只 log 不抛 → 静默残废)。
//
// 三个基准，各司其职：
//   APP_ROOT  代码资产的根 (技能源码、execTemplate、profiles/defaults、npc construction)
//   HOME_DIR  用户可见配置与运行时数据的根 (keys.json / bot.json / settings.json / skins/ / bots/)
//   DATA_ROOT 运行时状态的根 (= HOME_DIR，保持与历史上 `./bots/...` 的写法一致)
//
// 开发机上 APP_ROOT === HOME_DIR (都是仓库根)，行为与改造前完全一致；
// 只有在分发包 (`<包根>/app/`) 里两者才分开。

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 代码根：src/utils/paths.js → ../.. */
export const APP_ROOT = path.resolve(__dirname, '..', '..');

function resolveHome() {
    const env = process.env.MC_AGENT_HOME;
    if (env && env.trim()) return path.resolve(env.trim());
    // 分发布局 `<包根>/app/` —— 用户层在上一级
    if (path.basename(APP_ROOT).toLowerCase() === 'app') return path.dirname(APP_ROOT);
    // 开发布局 —— 代码根即用户层
    return APP_ROOT;
}

export const HOME_DIR = resolveHome();
export const DATA_ROOT = HOME_DIR;

/** 代码资产 (只读，随 app 发行) */
export function appPath(...segs) { return path.resolve(APP_ROOT, ...segs); }

/** 用户配置 (可写，用户会用记事本/面板碰它) */
export function homePath(...segs) { return path.resolve(HOME_DIR, ...segs); }

/** 运行时状态 (可写，用户不需要碰) */
export function dataPath(...segs) { return path.resolve(DATA_ROOT, ...segs); }

/** 单个配置文件 */
export function configPath(name) { return homePath(name); }

export const KEYS_FILE     = configPath('keys.json');
export const SETTINGS_FILE = configPath('settings.json');
export const SKINS_DIR     = homePath('skins');

/**
 * 热加载技能的搜索路径。app 内是随包发行的技能源码；home 内是用户/监工自己加的。
 * 开发机上两者重合，去重后只剩一个。
 */
export function skillDirs() {
    const dirs = [appPath('bots', '_supervisor', 'skills'), dataPath('bots', '_supervisor', 'skills')];
    return [...new Set(dirs.map(d => path.resolve(d)))];
}

/** 按名字在 skillDirs() 里找一个技能文件，找不到返回 null。 */
export function resolveSkillFile(skillName) {
    // 调用方负责校验 skillName 合法性 (^[A-Za-z0-9_-]+$)，这里再兜一层防路径穿越
    if (typeof skillName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(skillName)) return null;
    return skillDirs().map(d => path.join(d, `${skillName}.js`));
}

/** 把 profile 里的相对路径 (如 skins/neko.png) 展开成本机绝对路径。 */
export function expandUserPath(p) {
    if (typeof p !== 'string' || !p.trim()) return p;
    const s = p.trim();
    if (/^https?:\/\//i.test(s)) return s;          // URL 原样
    if (path.isAbsolute(s)) return path.resolve(s);
    return homePath(s);
}

export default { APP_ROOT, HOME_DIR, DATA_ROOT, appPath, homePath, dataPath, configPath, skillDirs, resolveSkillFile, expandUserPath, KEYS_FILE, SETTINGS_FILE, SKINS_DIR };
