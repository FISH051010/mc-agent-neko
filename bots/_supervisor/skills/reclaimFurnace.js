// Hot-reloadable REAL skill: ★T-0164 回滞留熔炉取锭+收炉 (RECLAIM_FURNACE 差事的执行端)。
// 20:40:57Z 实录: smeltSafe(raw_iron x8) 窗口丢后 8 铁留在 -54,22,24 附近的炉里, bot 走开 → tier 链白跑一趟。
// smeltSafe 把滞留落盘到 stranded_smelt.json; 本技能走回去 (≤64 格) 清炉 (锭+残料+燃料回包) 并把炉挖回背包。
// 返回: 收回了东西 → true; 炉不在/太远/无记录 → false (kernel 计失败; 无记录时提案端本就不提)。
// Invoked via: {"skill":"reclaimFurnace"}  ctx = { skills, world, mc, Vec3, log }
import { reclaimStranded, readStranded } from './smeltSafe.js';

export default async function reclaimFurnace(bot, ctx) {
    const { skills, world } = ctx;
    const log = (b, m) => { try { ctx.log(b, `reclaimFurnace: ${m}`); } catch (e) {} };
    const rec = readStranded();
    if (!rec) { log(bot, 'no stranded furnace record — nothing to do'); return false; }
    const ok = await reclaimStranded(bot, { skills, world, log }).catch(() => false);
    if (!ok && readStranded()) log(bot, `could not reclaim ${rec.n} ${rec.item} @${rec.x},${rec.y},${rec.z} yet`);
    return ok;
}
