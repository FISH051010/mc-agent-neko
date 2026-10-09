// Hot-reloadable REAL skill: ★T-0164 回滞留熔炉取锭+收炉 (RECLAIM_FURNACE 差事的执行端)。
// 20:40:57Z 实录: smeltSafe(raw_iron x8) 窗口丢后 8 铁留在 -55,21,23 的炉里, bot 走开 → tier 链白跑一趟。
// smeltSafe 把滞留落盘到 stranded_smelt.json (可多条); 本技能由近及远走回去清炉 (锭+残料+燃料回包)
// 并把炉挖回背包 — 空炉也挖回 (监工: 熔炉本身是资产)。执行端半径 = world_model 释放门 128 (提案门 96, 迟滞)。
// 返回: 收回了东西或挖回了炉 → true; 炉不在/太远/无记录 → false (kernel 计失败; 无记录时提案端本就不提)。
// Invoked via: {"skill":"reclaimFurnace"}  ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import { reclaimStranded, readAllStranded } from './smeltSafe.js';

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const EXEC_REACH = 128;

export default async function reclaimFurnace(bot, ctx) {
    const { skills, world } = ctx;
    // 落 progress.txt (21:03 实录: 只走 ctx.log, 现场看不到回收过程)
    const log = (b, m) => {
        try { ctx.log(b, `reclaimFurnace: ${m}`); } catch (e) {}
        try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] [reclaimFurnace] ${m}\n`); } catch (e) {}
    };
    if (!readAllStranded().length) { log(bot, 'no stranded furnace record — nothing to do'); return false; }
    const r = (await reclaimStranded(bot, { skills, world, log }, { all: true, reach: EXEC_REACH }).catch(() => null)) || { got: 0, furnaces: 0 };
    log(bot, `done: +${r.got} items, ${r.furnaces} furnace(s) picked up, ${readAllStranded().length} record(s) left`);
    return r.got > 0 || r.furnaces > 0;
}
