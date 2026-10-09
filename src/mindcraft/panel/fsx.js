// fsx.js — 面板层的文件读写小工具。
//
// 底座直接复用 bootstrap.js 的 readJsonSafe / writeJsonAtomic（BOM-safe + tmp→rename），
// 这里只补两样面板特有的东西：
//   1. .bak 备份 —— 用户在面板上点错一下就把 bot.json / settings.json 改坏是很常见的，
//      每次写盘前把上一版留一份，用户可以手动改名救回来。
//   2. 目录枚举 —— 皮肤库要列 *.png。
//
// ★踩坑记录（BOM JSON silent dispatch kill）：PowerShell 写出来的 JSON 带 UTF-8 BOM，
//   JSON.parse 会直接抛，历史上造成过"配置明明写了但进程读不到"的静默死局。
//   所以本仓一切 JSON 读取都必须走 readJsonSafe，禁止裸 JSON.parse(readFileSync(...))。

import fs from 'fs';
import path from 'path';
import { readJsonSafe, writeJsonAtomic } from '../../utils/bootstrap.js';

export { readJsonSafe, writeJsonAtomic };

/**
 * 原子写 + 保留上一版为 <file>.bak。
 * 备份失败不阻断写入（备份是锦上添花，写不进去才是真故障）。
 */
export function writeJsonBackup(file, obj) {
    try {
        if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    } catch (err) {
        console.warn(`[panel] 备份 ${file} 失败（继续写入）: ${err.message}`);
    }
    writeJsonAtomic(file, obj);
}

/** 列目录里符合扩展名的文件（不递归）。目录不存在时返回空数组，不抛。 */
export function listFiles(dir, ext = '') {
    let names;
    try {
        names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const suffix = ext ? ext.toLowerCase() : '';
    return names
        .filter(d => d.isFile())
        .map(d => d.name)
        .filter(n => !suffix || n.toLowerCase().endsWith(suffix))
        .sort((a, b) => a.localeCompare(b));
}

export function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 已存在 */ }
    return dir;
}

/**
 * 文件名消毒：只保留 [A-Za-z0-9_.-]，并砍掉任何目录成分。
 * 防的是 `../../keys.json` 这类路径穿越 —— 面板是本机 HTTP 服务，
 * 一旦允许穿越，浏览器里一个恶意页面就能写到仓库任意位置。
 */
export function sanitizeFileName(name, fallback = 'file') {
    const base = path.basename(String(name || ''));
    const cleaned = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '');
    return cleaned || fallback;
}

/** 目标路径必须落在 baseDir 之内，否则返回 null（第二道防穿越）。 */
export function resolveInside(baseDir, name) {
    const safe = sanitizeFileName(name, '');
    if (!safe) return null;
    const full = path.resolve(baseDir, safe);
    const base = path.resolve(baseDir);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return full;
}

export function fileSize(file) {
    try { return fs.statSync(file).size; } catch { return 0; }
}

export default {
    readJsonSafe, writeJsonAtomic, writeJsonBackup,
    listFiles, ensureDir, sanitizeFileName, resolveInside, fileSize,
};
