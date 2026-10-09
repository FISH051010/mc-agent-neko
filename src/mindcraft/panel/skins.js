// skins.js — 皮肤库。
//
// 皮肤怎么生效：agent.js 在 spawn 后发一条聊天指令
//   `/skin set upload <classic|slim> <绝对路径>`
// 由服务端的 FabricTailor 模组读取那个路径。**路径是服务端解析的**，所以必须写
// 展开后的绝对路径；相对路径会静默失败（皮肤不变、也不报错，最难查）。
//
// 上传校验为什么要做到字节级：
//   · 浏览器给的 Content-Type 是客户端说了算的，不可信；
//   · 尺寸不对（不是 64×64 / 64×32）FabricTailor 会拒绝，但用户只会看到"皮肤没变"；
//   · 文件名不消毒就是路径穿越漏洞 —— 本机 HTTP 服务上任何页面都能往仓库里写文件。

import fs from 'fs';
import path from 'path';
import { SKINS_DIR } from '../../utils/paths.js';
import { listFiles, ensureDir, sanitizeFileName, resolveInside, fileSize } from './fsx.js';
import { setSkin, currentSkin } from './bot_store.js';

export const MAX_SKIN_BYTES = 512 * 1024;
const PNG_MAGIC = globalThis.Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ALLOWED_SIZES = [[64, 64], [64, 32]];
// PNG colorType: 2=RGB(truecolor) 6=RGBA。皮肤要透明层，实际上几乎都是 6。
const ALLOWED_COLOR_TYPES = new Set([2, 6]);

/**
 * 解析 PNG 头。返回 {width,height,bitDepth,colorType}；不是合法 PNG 返回 null。
 * PNG 布局：8 字节魔数 → 4 字节块长度(必须 13) → 'IHDR' → 宽(4) 高(4) 位深(1) 颜色类型(1)
 */
export function parsePngHeader(buf) {
    if (!buf || buf.length < 33) return null;
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
    if (buf.readUInt32BE(8) !== 13) return null;
    if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
        bitDepth: buf.readUInt8(24),
        colorType: buf.readUInt8(25),
    };
}

function readHeaderOfFile(file) {
    let fd = null;
    try {
        fd = fs.openSync(file, 'r');
        const buf = globalThis.Buffer.alloc(33);
        fs.readSync(fd, buf, 0, 33, 0);
        return parsePngHeader(buf);
    } catch {
        return null;
    } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    }
}

/** 64×32 是 1.8 以前的老皮肤，只有 classic 版型；64×64 两种都行。 */
function guessVariant(header) {
    if (!header) return 'classic';
    return header.height === 32 ? 'classic' : 'slim';
}

export function listSkins() {
    ensureDir(SKINS_DIR);
    const cur = currentSkin();
    const skins = listFiles(SKINS_DIR, '.png').map(file => {
        const full = path.join(SKINS_DIR, file);
        const header = readHeaderOfFile(full);
        return {
            file,
            name: file.replace(/\.png$/i, ''),
            size: fileSize(full),
            width: header ? header.width : 0,
            height: header ? header.height : 0,
            variant: guessVariant(header),
            current: cur === file,
        };
    });
    return { skins, current: cur && skins.some(s => s.file === cur) ? cur : null };
}

/**
 * 保存上传的皮肤。
 * @param {Buffer} buf 原始 PNG 字节
 * @param {string} filename 客户端给的文件名（会被消毒）
 * @throws {Error} 中文 message
 */
export function saveSkin(buf, filename) {
    if (!buf || !buf.length) throw new Error('没有收到图片内容。');
    if (buf.length > MAX_SKIN_BYTES) {
        throw new Error(`图片太大了（${Math.round(buf.length / 1024)} KB），皮肤文件不能超过 512 KB。`);
    }
    const header = parsePngHeader(buf);
    if (!header) throw new Error('这不是一个 PNG 图片。皮肤必须是 .png 格式。');

    const sizeOk = ALLOWED_SIZES.some(([w, h]) => header.width === w && header.height === h);
    if (!sizeOk) {
        throw new Error(`皮肤尺寸必须是 64×64（新版）或 64×32（老版），你这张是 ${header.width}×${header.height}。`);
    }
    if (!ALLOWED_COLOR_TYPES.has(header.colorType)) {
        throw new Error('这张 PNG 的颜色格式游戏不认（需要 RGB 或带透明的 RGBA）。用画图另存为一次通常就能修好。');
    }

    let safe = sanitizeFileName(filename, 'skin.png');
    if (!/\.png$/i.test(safe)) safe += '.png';
    ensureDir(SKINS_DIR);
    const target = resolveInside(SKINS_DIR, safe);
    if (!target) throw new Error('文件名不合法。');

    // 原子写：先 .tmp 再 rename，避免半截文件被当成皮肤读走
    const tmp = `${target}.${globalThis.process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);

    return {
        file: path.basename(target),
        width: header.width,
        height: header.height,
        variant: guessVariant(header),
        size: buf.length,
    };
}

/** 选中某张皮肤，写进 bot.json。 */
export function selectSkin(file, variant) {
    const target = resolveInside(SKINS_DIR, file);
    if (!target || !fs.existsSync(target)) throw new Error('找不到这张皮肤，可能已经被删掉了。');
    if (variant !== undefined && variant !== 'classic' && variant !== 'slim') {
        throw new Error('版型只能是 classic（宽手臂）或 slim（细手臂）。');
    }
    const v = variant || guessVariant(readHeaderOfFile(target));
    setSkin(path.basename(target), v);
    return { file: path.basename(target), variant: v };
}

export function deleteSkin(file) {
    const target = resolveInside(SKINS_DIR, file);
    if (!target) throw new Error('文件名不合法。');
    if (!fs.existsSync(target)) throw new Error('这张皮肤已经不在了。');
    const name = path.basename(target);
    if (currentSkin() === name) {
        // 正在用的皮肤被删了 → 同时把 bot.json 里的引用清掉，否则下次启动会发一条
        // 指向不存在文件的 /skin set，服务端静默失败
        setSkin(null, 'classic');
    }
    fs.unlinkSync(target);
    return { file: name };
}

/** 预览图的绝对路径；不存在返回 null。 */
export function skinFilePath(file) {
    const target = resolveInside(SKINS_DIR, file);
    if (!target || !fs.existsSync(target)) return null;
    return target;
}

export { SKINS_DIR };
export default { listSkins, saveSkin, selectSkin, deleteSkin, skinFilePath, parsePngHeader, MAX_SKIN_BYTES, SKINS_DIR };
