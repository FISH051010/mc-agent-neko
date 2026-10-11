// mineDown — a SAFE sealed 1-wide descending staircase miner. The bot keeps dying/stalling
// because it never closes the armor gap (86% of deaths are unarmored), and the patch
// layers gate it out of ALL mining — so it stands down forever in food deserts. But mining a
// 1-wide staircase is SAFE even at hp10: you are always in a single-block slot no mob can reach.
// This gets the bot DOWN to the iron band, collecting ore en route, breaking the surface
// stand-down deadlock and feeding the iron->armor chain.
//
// Reuses the safety idiom proven in escapePlan: pure cellSafety() (lava/bedrock), breakBlockAt,
// and a low-level forward walk (no pathfinder — descent is a 1-block drop the bot falls into).
//
// opts: { steps=40, heading=null (auto), targetY=45 }

import { collectExposedOresDuringDescent } from './descentOreSweep.js';
import { kernelYieldRequested } from './surfaceUp.js';
import { hostileActionable, hostileRawNear, DESCENT_HOSTILE_R } from '../../../src/agent/framework/hostile_reach.js';   // ★T-0225 shooter-in-view check (T-0222 predicate)   // ★T-0190 kernel commitment-flip stamp (T-0181)
import fs from 'fs';
import path from 'path';
import { ensureCarriedTable } from '../../../src/agent/framework/ensure_table.js';   // ★T-0264 shared pocket-table primitive
import { reflexGateRefusals, reflexHolds } from '../../../src/agent/framework/reflex_body_gate.js';   // ★T-0267 borrowed body ≠ wedge
import { installDigAbortProbe, DIG_ABORT_PROBE_V } from '../../../src/agent/framework/dig_abort_probe.js';   // ★T-0260
// ★T-0137 (监工: 18:43/18:49 mineDown 3 连败冷却, progress.txt 零行 mineDown 日志): log_ 只进 bot 内部输出,
//   每个拒跑/abort 原因都对监工不可见。现在同时落 progress.txt — 拒跑闸 / DONE 结果 / abort 原因一行一条。
const PROG_MD = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
export function progLine(m) { try { fs.appendFileSync(PROG_MD, `[${new Date().toISOString()}] [mineDown] ${m}\n`); } catch (e) {} }

// ★C311 (T-0048): WATER was missing here — only lava was guarded. mineDown dug a staircase
// straight into an aquifer at depth (y35) and the bot drowned (#112), while its siblings
// branchMine (BAD_FLUID=/lava|water/) and digDown (_WL incl. water) both stop on water.
// Water in the feet/head/floor cell, or flowing in from a side, must STOP the descent.
const FLUID = /(lava|flowing_lava|water|flowing_water)/;
const UNBREAKABLE = /(bedrock|barrier|obsidian|reinforced_deepslate)/;

// PURE: descending-staircase feet-cell sequence from start along a cardinal heading.
// Each step moves 1 on the heading axis and 1 down. Deterministic, offline-testable.
function stairCells(start, sx, sz, n) {
    const cells = [];
    let x = start.x, y = start.y, z = start.z;
    for (let i = 0; i < n; i++) { x += sx; z += sz; y -= 1; cells.push({ x, y, z }); }
    return cells;
}

// PURE: safe to dig+drop into this stair cell? reads = {feet,head,floor,fluidNear}
function stairSafety(reads) {
    if (reads.fluidNear) return { safe: false, reason: 'fluid (lava/water) near stair cell' };
    if (FLUID.test(reads.feet || '') || FLUID.test(reads.head || '') || FLUID.test(reads.floor || '')) return { safe: false, reason: 'fluid in/under stair cell' };
    if (UNBREAKABLE.test(reads.feet || '') || UNBREAKABLE.test(reads.head || '')) return { safe: false, reason: `unbreakable (${reads.feet}/${reads.head})` };
    return { safe: true, reason: 'ok' };
}

// ★T-0137② VOID HOP (监工规格): a 'no floor support' abort (cave void under the next stair cell) used to end the
//   dispatch → 3-strike cooldown → re-dispatch onto the same void (live 03:03:06/27 @-3,43,-1). A human turns
//   or shuffles a few blocks sideways and starts the stair again. Pure planner over blockAt-style reads:
//   ① turn in place to a cardinal whose stair cell has 3 solid blocks under it; else
//   ② walk ≤4 blocks along a perpendicular/reverse line on solid footing to a column with 3 solid below and a
//      viable stair heading from there. Returns null when nothing safe is in reach (honest abort).
/** Walk a planned same-level line cell by cell, breaking feet/head blocks first (shared by void hop + relocate). */
export async function walkDugPath(bot, skills, Vec3, bn, path) {
    const dist = (tx, tz) => { const pp = bot.entity.position; return Math.hypot(pp.x - (tx + 0.5), pp.z - (tz + 0.5)); };
    for (let ci = 0; ci < path.length; ci++) {
        const [tx, tz] = path[ci];
        const cyf = Math.floor(bot.entity.position.y);
        for (const by of [cyf + 1, cyf]) {
            const b = bn(tx, by, tz);
            if (b && b.boundingBox === 'block') { try { await skills.breakBlockAt(bot, tx, by, tz); } catch (e) {} }
        }
        // ★T-0161 ghost (live 21:06:30-51: 'walk stopped early … feet=air head=air', body parked at the next cell's
        //   face): the dig landed client-side only. Walk until arrived or STALLED (no progress 0.5s); a stall short of
        //   the cell = server-solid ghost → dig the 'air' cells (the server answers with the real block / breaks it),
        //   then walk again. ≤2 ghost digs per cell; 0.6 arrival bar (the old 0.8 let a face-parked body "arrive").
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await bot.lookAt(new Vec3(tx + 0.5, cyf + 0.5, tz + 0.5), true);
                bot.setControlState('forward', true);
                const t0 = Date.now();
                let best = dist(tx, tz), bestAt = t0;
                while (Date.now() - t0 < 1500) {
                    const d = dist(tx, tz);
                    if (d < 0.45) break;
                    if (d < best - 0.05) { best = d; bestAt = Date.now(); }
                    else if (Date.now() - bestAt > 500) break;      // stalled
                    await new Promise(r => setTimeout(r, 100));
                }
            } finally { try { bot.setControlState('forward', false); } catch (e) {} }
            if (dist(tx, tz) < 0.45 || attempt === 2) break;
            for (const by of [cyf + 1, cyf]) {
                const g = bn(tx, by, tz);
                if (!g || /water|lava|bedrock/.test(g.name || '')) continue;
                try {
                    await bot.lookAt(new Vec3(tx + 0.5, by + 0.5, tz + 0.5), true);
                    if (g.boundingBox === 'block') await skills.breakBlockAt(bot, tx, by, tz);
                    else { const dp = bot.dig(g, true); if (dp && dp.catch) dp.catch(() => {}); await Promise.race([dp, new Promise(r => setTimeout(r, 2000))]); }
                } catch (e) {}
                try { bot.stopDigging(); } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 250));   // let the server's block_change correction land
        }
        if (dist(tx, tz) > 0.6) {
            const pp = bot.entity.position;
            const nmB = (b) => (b && b.name) || '?';
            bot._walkDugFail = `cell ${ci + 1}/${path.length} @${tx},${cyf},${tz} feet=${nmB(bn(tx, cyf, tz))} head=${nmB(bn(tx, cyf + 1, tz))} floor=${nmB(bn(tx, cyf - 1, tz))} pos=${pp.x.toFixed(2)},${pp.y.toFixed(2)},${pp.z.toFixed(2)} ground=${!!bot.entity.onGround}`;
            return false;
        }
    }
    bot._walkDugFail = null;
    return true;
}

// ★T-0161 地下换址 = 开横向短隧道 (人类做法)。四向皆被 fluid/void/wedge 记忆覆盖时, 旧 lever#1 调 skills.moveAway(10)
//   (pathfinder GoalInvert) — 在实心岩层隧道里原地不动 (live 04:23/04:26 @-39,40,5 'relocate failed (moved=0.0b)' ×5;
//   两份 progress 史上 'relocated … to fresh ground' 成功 0 次)。改为: 当前层选一个基本方向, 沿途 len 格的脚/头格非流体非
//   不可破、脚下实心、且脚/头格及头顶的侧邻无流体 (别挖穿含水层), 挖过去 ≥8 格 → 越出朝向记忆半径 8, 回到干净起点。
export function planRelocateTunnel(bn, cx, cy, cz, len = 9) {
    const nm = (b) => (b && b.name) || 'air';
    const solid = (b) => !!(b && b.boundingBox === 'block' && !FLUID.test(nm(b)));
    const passable = (b) => !FLUID.test(nm(b)) && !UNBREAKABLE.test(nm(b));
    const wet = (x, y, z) => FLUID.test(nm(bn(x, y, z)));
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const path = [];
        let ok = true;
        for (let d = 1; d <= len && ok; d++) {
            const x = cx + dx * d, z = cz + dz * d;
            if (!passable(bn(x, cy, z)) || !passable(bn(x, cy + 1, z)) || !solid(bn(x, cy - 1, z))) { ok = false; break; }
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wet(x + ox, cy, z + oz) || wet(x + ox, cy + 1, z + oz)) { ok = false; break; }
            if (ok && wet(x, cy + 2, z)) ok = false;
            path.push([x, z]);
        }
        if (ok) return { sx: dx, sz: dz, path };
    }
    return null;
}

// ★T-0184 干竖井换址 (COOLDOWN-CHURN GO_UNDERGROUND ×3; 01-02h 'fluid near stair cell' ×11 @-31,39,-62): re-heading
//   and 9b tunnels kept the bot in the same aquifer. Tunnel 6..16b along a cardinal (same dry-sided checks as
//   planRelocateTunnel) to the nearest end column whose whole way down is dry: no fluid within r blocks horizontally
//   from the feet level down to targetY. Column wetness is memoised (≈ tens of k blockAt worst case). null = none.
export function planDryTunnel(bn, cx, cy, cz, targetY, { minLen = 6, maxLen = 16, r = 2 } = {}) {
    const nm = (b) => (b && b.name) || 'air';
    const solid = (b) => !!(b && b.boundingBox === 'block' && !FLUID.test(nm(b)));
    const passable = (b) => !FLUID.test(nm(b)) && !UNBREAKABLE.test(nm(b));
    const wet = (x, y, z) => FLUID.test(nm(bn(x, y, z)));
    const yLo = Math.min(cy - 1, Math.max(-60, Number.isFinite(targetY) ? targetY : cy - 30));
    // ★T-0184 续 (live 04:45:37: dry end column, but the stair then walked forward into water): check the cells the
    //   STAIRCASE will occupy — layer k down is k cells further along the heading — feet+head level, radius r. Memoised.
    const memo = new Map();
    const wetM = (x, y, z) => { const key = `${x},${y},${z}`; if (!memo.has(key)) memo.set(key, wet(x, y, z)); return memo.get(key); };
    const stairDry = (x, z, dx, dz) => {
        const yStop = Math.max(yLo, cy - 1 - 32);   // ≤32 layers (one dispatch descends ≤40 steps) — bounded blockAt budget
        for (let k = 0, y = cy - 1; y >= yStop; k++, y--) {
            const sx0 = x + dx * k, sz0 = z + dz * k;
            for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) if (wetM(sx0 + ox, y, sz0 + oz) || wetM(sx0 + ox, y + 1, sz0 + oz)) return false;
        }
        return true;
    };
    let best = null;
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const path = [];
        for (let d = 1; d <= maxLen; d++) {
            const x = cx + dx * d, z = cz + dz * d;
            if (!passable(bn(x, cy, z)) || !passable(bn(x, cy + 1, z)) || !solid(bn(x, cy - 1, z))) break;
            let sideWet = false;
            for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wet(x + ox, cy, z + oz) || wet(x + ox, cy + 1, z + oz)) { sideWet = true; break; }
            if (sideWet || wet(x, cy + 2, z)) break;
            path.push([x, z]);
            if (d >= minLen && (!best || d < best.path.length) && stairDry(x, z, dx, dz)) { best = { sx: dx, sz: dz, path: path.slice(), dryShaft: true }; break; }
        }
    }
    return best;
}

/** ★T-0183: nothing solid in the first h blocks above the head = under open sky (surface pathfinding works here).
 *  A tree canopy (leaves/logs/vines) is not a roof (live 23:06 @-8,69,-7: spruce canopy blocked the relocate). */
export function openSkyAbove(bn, x, y, z, h = 24) {
    for (let dy = 2; dy <= h; dy++) {
        const b = bn(x, y + dy, z);
        if (b && b.boundingBox === 'block' && !/leaves|_log$|_wood$|vine/.test(b.name || '')) return false;
    }
    return true;
}

// ★T-0183 (live 23:06: pathfinder moveAway landed on the SAME cave roof, A↔B 10b apart): a surface relocation must
//   aim at ground known to be solid. Nearest column 6..24b away whose feet+head cells are open (no fluid) and whose
//   5 blocks under the feet are solid — a staircase can start there without hitting the cave. null = none in range.
const SOLID_COL_OFFSETS = (() => {
    const out = [];
    for (let dx = -24; dx <= 24; dx++) for (let dz = -24; dz <= 24; dz++) { const d = Math.hypot(dx, dz); if (d >= 6 && d <= 24) out.push([dx, dz, d]); }
    return out.sort((a, b) => a[2] - b[2]);
})();
export function planSolidColumn(bn, cx, cy, cz, skip = null) {
    const nm = (b) => (b && b.name) || 'air';
    const fluid = (b) => FLUID.test(nm(b));
    const solid = (b) => !!(b && b.boundingBox === 'block' && !fluid(b));
    const open = (b) => !solid(b) && !fluid(b);
    for (const [dx, dz] of SOLID_COL_OFFSETS) {
        const x = cx + dx, z = cz + dz;
        if (skip && skip.has(`${x},${z}`)) continue;   // ★T-0193 already tried and unreachable
        for (const dy of [0, 1, -1, 2, -2, 3, -3]) {
            const y = cy + dy;
            if (!open(bn(x, y, z)) || !open(bn(x, y + 1, z))) continue;
            let ok = true;
            for (let d = 1; d <= 5 && ok; d++) if (!solid(bn(x, y - d, z))) ok = false;
            if (ok) return { x, y, z };
        }
    }
    return null;
}

/** ★T-0187: at-band tolerance shrinks with the requested depth — a shallow request (STONE_BOOTSTRAP y-6) must still
 *  dig down (live 23:06:36: tolerance 6 == request 6 → 'reached targetY at step 0', dug=0). Deep requests keep 6. */
export function descendTolerance(startY, targetY) {
    return Math.max(0, Math.min(6, Math.floor((startY - targetY) / 3)));
}

/** ★T-0193: pathfinder walk to a planned column, bounded (live 00:04:30 a relocate hung 43s). true = within 2.5b. */
export async function goToColumn(bot, skills, dest, ms = 20000) {
    let timer = null;
    try {
        await Promise.race([
            Promise.resolve().then(() => skills.goToPosition(bot, dest.x, dest.y, dest.z, 1)).catch(() => {}),
            new Promise(r => { timer = setTimeout(r, ms); }),
        ]);
    } finally { if (timer) clearTimeout(timer); }
    const p = bot.entity.position;
    const ok = Math.hypot(p.x - (dest.x + 0.5), p.z - (dest.z + 0.5)) <= 2.5;
    if (!ok) { try { bot.pathfinder.stop(); } catch (e) {} try { bot.clearControlStates(); } catch (e) {} }
    return ok;
}

/** ★T-0193 relocation when no dry tunnel line works: walk (own tunnels / surface) to a solid column 6-24b away;
 *  surface-only moveAway as a last resort (it has never moved the bot underground); underground → fail fast. */
export async function relocateFallback(bot, skills, bn, log_, why, { ms = 20000 } = {}) {
    const p = bot.entity.position;
    const cx = Math.floor(p.x), cy = Math.round(p.y), cz = Math.floor(p.z);
    // ★T-0193 (live 01:23:48-59: the nearest column was a sealed cave, 'not reached' ×3 → 3 strikes): try the next
    //   candidates too (≤3, within the same overall time budget); an unreachable one fails fast (noPath).
    const skip = new Set();
    const t0 = Date.now();
    let dest = planSolidColumn(bn, cx, cy, cz, skip);
    const hadColumn = !!dest;
    for (let n = 0; dest && n < 3 && Date.now() - t0 < ms; n++) {
        const ok = await goToColumn(bot, skills, dest, Math.max(1000, ms - (Date.now() - t0)));
        log_(`relocate: ${why} — path to solid column ${dest.x},${dest.y},${dest.z} ${ok ? 'arrived' : 'not reached'}${n ? ` (candidate ${n + 1})` : ''}`);
        if (ok) return true;
        skip.add(`${dest.x},${dest.z}`);
        dest = planSolidColumn(bn, cx, cy, cz, skip);
    }
    if (hadColumn) return false;
    if (openSkyAbove(bn, cx, cy, cz) || (bot._mobility && bot._mobility.enclosed === false)) {
        log_(`relocate: ${why} — surface, no solid column found; moveAway`);
        try { await skills.moveAway(bot, 10); } catch (e) {}
        return true;
    }
    log_(`relocate: ${why} — underground, no solid column in reach; honest fail (moveAway never moves underground)`);
    return false;
}

/** ★T-0198 return-contract progress: descended (≥3 after a wedge-final moveAway, else ≥1), ore gained, or ≥3 cobble
 *  gained (live 00:27:38: 23 blocks dug for NIGHT_STONE_BOOTSTRAP, moveAway climbed back 1 → judged zero-progress). */
export function dispatchProgressed({ wedgeFinal, entryY, endY, oreGain, cobbleGain }) {
    const down = entryY - endY;
    return (wedgeFinal ? down >= 3 : down >= 1) || oreGain > 0 || cobbleGain >= 3;
}

// ★T-0225 (death #22 04:51:25: 'hostile-steer: skeleton @9.0b' turned the stair but kept digging; the skeleton followed
//   and shot it at 4.6b). Turning away is useless against a shooter that can SEE you. Nearest ranged hostile within r
//   that is actionable (line of sight — T-0222 hostileActionable); null when none.
const MD_RANGED_RE = /^(skeleton|stray|bogged|pillager|witch|blaze|ghast|evoker|breeze)$/;
export function shooterToCover(bot, r = 10) {
    let best = null, bd = Infinity;
    try {
        const p = bot.entity.position;
        for (const id in (bot.entities || {})) {
            const e = bot.entities[id];
            if (!e || !e.position || !MD_RANGED_RE.test(e.name || '')) continue;
            if (!hostileActionable(bot, e, r)) continue;
            const d = e.position.distanceTo(p);
            if (d < bd) { bd = d; best = e; }
        }
    } catch (e) {}
    return best;
}

export function planVoidHop(bn, cx, cy, cz, sx, sz, avoid = [], R = 4) {
    const nm = (b) => (b && b.name) || 'air';
    const solid = (b) => !!(b && b.boundingBox === 'block' && !FLUID.test(nm(b)));
    const passable = (b) => !FLUID.test(nm(b)) && !UNBREAKABLE.test(nm(b));   // diggable or open
    const avoided = (dx, dz) => avoid.some(a => a.sx === dx && a.sz === dz);
    const stairOk = (x, y, z, dx, dz) => {
        const fx = x + dx, fz = z + dz;
        if (!passable(bn(fx, y - 1, fz)) || !passable(bn(fx, y, fz)) || !passable(bn(fx, y + 1, fz))) return false;
        return solid(bn(fx, y - 2, fz)) && solid(bn(fx, y - 3, fz)) && solid(bn(fx, y - 4, fz));   // 3 solid below the new feet
    };
    const CARD = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [dx, dz] of CARD) {
        if ((dx === sx && dz === sz) || avoided(dx, dz)) continue;
        if (stairOk(cx, cy, cz, dx, dz)) return { kind: 'turn', sx: dx, sz: dz, path: [] };
    }
    for (const [lx, lz] of [[-sz, sx], [sz, -sx], [-sx, -sz]]) {   // perpendiculars first, then back away
        const path = [];
        for (let d = 1; d <= R; d++) {
            const x = cx + lx * d, z = cz + lz * d;
            if (!passable(bn(x, cy, z)) || !passable(bn(x, cy + 1, z)) || !solid(bn(x, cy - 1, z))) break;   // footing must hold
            path.push([x, z]);
            if (!(solid(bn(x, cy - 2, z)) && solid(bn(x, cy - 3, z)))) continue;    // column needs 3 solid below
            for (const [dx, dz] of CARD) {
                if (dx === -lx && dz === -lz) continue;                              // don't stair back toward the void
                if (stairOk(x, cy, z, dx, dz)) return { kind: 'hop', x, z, sx: dx, sz: dz, path: path.slice() };
            }
        }
    }
    return null;
}

// ★T-0139 reopened (监工, live 10-11 02:25-02:27Z @278..284,58,-41..-44): a one-block cave roof over a big cavity —
//   every heading 'no floor support … (air)', no hop column, 7 dispatches → cooldown, with 414 cobblestone in the pack.
//   A human doesn't walk away from a cave roof: if the cave floor is close they step down into it (≤3 blocks = no fall
//   damage), otherwise they put a block under the next step and keep going (挖三填一).
//   → { kind:'drop', depth, landY } | { kind:'bridge', place:[{x,y,z,on}] } | null.  `on` = placeBlock's placeOn
//   (the side of the target the reference block is on). Air voids only — fluids keep their own branch.
export const VOID_SAFE_DROP = 3;
const VOID_AIR_RE = /^(air|cave_air|void_air)$/;
const BAD_LANDING_RE = /^(magma_block|campfire|soul_campfire|pointed_dripstone|powder_snow|sweet_berry_bush|cactus)$/;
export function planVoidBridge(bn, cx, cy, cz, sx, sz) {
    const nm = (b) => (b && b.name) || 'air';
    const solid = (b) => !!(b && b.boundingBox === 'block' && !FLUID.test(nm(b)));
    const fx = cx + sx, fz = cz + sz;
    if (!VOID_AIR_RE.test(nm(bn(fx, cy - 2, fz)))) return null;
    // ① shallow cave: first solid within VOID_SAFE_DROP under the support cell, every cell on the way plain air
    for (let m = 1; m <= VOID_SAFE_DROP; m++) {
        const b = bn(fx, cy - 2 - m, fz);
        if (VOID_AIR_RE.test(nm(b))) continue;
        if (solid(b) && !BAD_LANDING_RE.test(nm(b)) && !MD_GRAV_RE.test(nm(b))) return { kind: 'drop', depth: m, landY: cy - 1 - m };
        break;   // fluid / junk / gravity block in the way → don't drop
    }
    // ② deep (or wet) cave: build the support. Against the new-feet cell's underside when it is rock (cave roof);
    //    when it is open too, first fill it from our own floor's side, then the support under it (dug again next).
    const feet = bn(fx, cy - 1, fz);
    if (FLUID.test(nm(feet))) return null;
    const support = { x: fx, y: cy - 2, z: fz, on: 'top' };
    if (solid(feet)) return { kind: 'bridge', place: [support] };
    if (!solid(bn(cx, cy - 1, cz))) return null;
    const SIDE = { '-1,0': 'west', '1,0': 'east', '0,-1': 'north', '0,1': 'south' };
    return { kind: 'bridge', place: [{ x: fx, y: cy - 1, z: fz, on: SIDE[`${-sx},${-sz}`] }, support] };
}

// ★T-0148 诊断 (监工): 'Digging aborted' = 别人在我们挖到一半时开了新 dig 或调了 stopDigging。把那一刻谁持有身体/
//   挖掘槽/在挖什么记进 DONE, 下次一眼看出是孤儿 chopWood、反射 mode 还是 pathfinder。只诊断, 不改 strike 计数。
// ★T-0267 (live 10-11 05:18:42-58Z @75,66,166: mineDown forward refused by the T-0231 gate while item_collecting held the body
//   (picking up mineDown's own ore-sweep drops) → no progress → noProg → 'ghost-buster: resync cleared=0 fwdOpen=true' ×2 burned on
//   nothing; 05:07:55-05:08:03 same shape under self_preservation → 'wedge x4 at same spot' honest fail). A step whose walk was
//   refused by the body gate is a reflex hold, not a wedge: wait for the reflex to let go and take the step again. Bounded.
export const REFLEX_STEP_WAITS_MAX = 8;
export function stepOutcome({ descended, movedHoriz, gateBlocked, reflexWaits = 0 }) {
    if (descended || movedHoriz) return 'progress';
    if (gateBlocked && reflexWaits < REFLEX_STEP_WAITS_MAX) return 'reflex';
    return 'wedge';
}

export function digInterrupter(bot) {
    try {
        const o = bot._bodyOwner;
        const t = bot.targetDigBlock;
        const a = bot._lastDigAbort;   // ★T-0260 who actually called stopDigging (probe below)
        const by = a && Date.now() - a.at < 3000 ? ` abortBy=${a.by || '?'}` : '';
        return `[by owner=${o ? o.name : '-'} digSlot=${bot._bodyDigLockOwner || '-'} digging=${t ? t.name + '@' + t.position : '-'} chopGen=${bot._chopGen ?? '-'}${by}]`;
    } catch (e) { return '[by ?]'; }
}

// ★T-0260 (live 10-11 04:22:54-57Z @45,67,-24: mineDown ×3 step-0 'Digging aborted [by owner=- …]' within ~1ms → GO_UNDERGROUND
//   cooled; also 03:25:29). mineflayer raises 'Digging aborted' only from bot.stopDigging(), which emits 'diggingAborted'
//   synchronously — the listener's stack holds the real caller (bot.stopDigging itself is reassigned per dig, so it can't be
//   wrapped). Installed once per bot from a hot-reloaded skill; frames outside node_modules, top 4.
// ★T-0260 dig-abort probe lives in src/agent/framework/dig_abort_probe.js (modes installs it at startup); re-exported here.
export { installDigAbortProbe, DIG_ABORT_PROBE_V };

// ★T-0139: heading memory for step-0 terrain aborts, shared by the fluid abort and the no-floor (cave void)
//   abort. The no-floor abort used to skip it → every re-dispatch walked the same deterministic heading into
//   the same void (live 10-10 02:58:23→26 @-3,43,-1: 3× 'no floor support … (air)', dig=0 → GO_UNDERGROUND
//   cooldown 5min). TTL 10min, bot-object state (survives hot reload).
export const ABORT_HEADING_TTL_MS = 600000;
export function rememberAbortedHeading(bot, sx, sz, now = Date.now(), why = '') {
    try { (bot._mineDownFluidAvoid = bot._mineDownFluidAvoid || []).push({ x: bot.entity.position.x, z: bot.entity.position.z, sx, sz, at: now, why }); } catch (e) {}
}
// ★T-0162 aquifer (death #10 22:04:16 drowning): water on 3 sides at one spot = an aquifer. Descending the last
//   "dry" heading walked into it 3 steps later. Count distinct WET headings near p0; ≥3 → leave sideways (tunnel).
export const AQUIFER_WET_HEADINGS = 3;
export function aquiferHere(avoidList, p0, now = Date.now()) {
    const wet = new Set();
    for (const a of avoidList || []) {
        if (a.why !== 'fluid' || now - a.at >= ABORT_HEADING_TTL_MS || Math.hypot(a.x - p0.x, a.z - p0.z) >= 8) continue;
        wet.add(`${a.sx},${a.sz}`);
    }
    return wet.size >= AQUIFER_WET_HEADINGS;
}
/** First cardinal not aborted within 8 blocks of p0 (TTL'd); returns null when every cardinal failed here. */
export function rotateAwayFromAborted(avoidList, p0, sx, sz, now = Date.now()) {
    const avoid = (avoidList || []).filter(a => now - a.at < ABORT_HEADING_TTL_MS && Math.hypot(a.x - p0.x, a.z - p0.z) < 8);
    if (!avoid.some(a => a.sx === sx && a.sz === sz)) return { sx, sz, rotated: false, avoid };
    const clean = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([cx, cz]) => !avoid.some(a => a.sx === cx && a.sz === cz));
    return clean ? { sx: clean[0], sz: clean[1], rotated: true, avoid } : { sx, sz, rotated: false, exhausted: true, avoid };
}

// ★T-0158 (death #7 10-09 20:08:26 suffocation @y32, 前一刻从 y49 坠到 y32): 砂砾层里的两个重力坑。
const MD_GRAV_RE = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]*concrete_powder)$/;
const MD_VOIDISH_RE = /^(air|cave_air|void_air|water|flowing_water|lava|flowing_lava)$/;
/**
 * ① 落脚支撑是悬在空洞上的重力块 → 挖开其上那格它就塌, bot 踩空 (= 当作无支撑, 走 void-hop)。
 *    `below` = 支撑格下方从上到下的方块名; 叠着的砂砾一路往下, 第一个非重力格是空/液体 = 整摞都会塌。
 */
export function supportCollapses(supportName, below) {
    if (!MD_GRAV_RE.test(supportName || '')) return false;
    for (const n of (Array.isArray(below) ? below : [below])) {
        if (MD_GRAV_RE.test(n || '')) continue;          // stacked gravel — keep looking down
        return MD_VOIDISH_RE.test(n || '');
    }
    return false;   // all gravity within the probe — no void seen
}
/**
 * ② 新站位列 (feet..clear) 头顶上方是否还会掉重力块进来: 从 topY+1 往上走, 先遇到重力块 = 会塌;
 *    先遇到非重力实心 = 被托住不会塌。列内三格本身还是重力块 = 回填了, 也算未清。
 */
export function gravityPendingAbove(bn, x, feetY, z, span = 6) {
    for (let y = feetY; y <= feetY + 2; y++) if (MD_GRAV_RE.test(((bn(x, y, z) || {}).name) || '')) return true;
    for (let y = feetY + 3; y <= feetY + 2 + span; y++) {
        const n = ((bn(x, y, z) || {}).name) || '';
        if (MD_GRAV_RE.test(n)) return true;
        if (!MD_VOIDISH_RE.test(n)) return false;   // solid non-gravity roof holds the column
    }
    return false;
}

export default async function mineDown(bot, ctx, opts = {}) {
    const { log, skills, Vec3 } = ctx;
    installDigAbortProbe(bot);   // ★T-0260 name the stopDigging caller in 'Digging aborted' DONE lines
    const mdEnteredAt = Date.now();
    const steps = opts.steps || 40;
    const targetY = opts.targetY != null ? opts.targetY : 45;
    const log_ = (m) => { log(bot, `[mineDown] ${m}`); progLine(m); };
    progLine(`START y=${Math.round(bot.entity.position.y)} targetY=${targetY} picks=${bot.inventory.items().filter(i => /_pickaxe$/.test(i.name || '')).map(i => i.name).join(',') || 'none'}`);
    const bn = (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)); } catch { return null; } };
    const nm = (b) => (b && b.name) || 'air';

    // ★P2-8b GHOST PREVENTION (2026-07-07): a fresh respawn/teleport can start this low-level
    // (no-pathfinder) descent before the client chunk cache has synced with the server — the walk
    // then physically collides with blocks the client renders as air (the ghost-block wedge, live
    // 06:01Z "walked into it as 'air'"). Let the local columns finish loading first. waitForChunksToLoad
    // is an instant no-op if they're already loaded, and self-caps at 10s; a 3s outer race keeps a
    // partial load from stalling the whole dispatch. Best-effort — never blocks the skill on failure.
    try { await Promise.race([bot.waitForChunksToLoad(), new Promise(r => setTimeout(r, 3000))]); } catch (e) {}

    // Heading: prefer away from the nearest hostile (don't dig toward a mob); else +x.
    let sx = 1, sz = 0;
    try {
        const p = bot.entity.position;
        let nearest = null, nd = Infinity;
        for (const e of Object.values(bot.entities || {})) {
            if (e && e !== bot.entity && e.position && ctx.mc.isHostile(e)) { const d = e.position.distanceTo(p); if (d < nd) { nd = d; nearest = e; } }
        }
        if (nearest && nd < 24) { const dx = p.x - nearest.position.x, dz = p.z - nearest.position.z; if (Math.abs(dx) >= Math.abs(dz)) { sx = Math.sign(dx) || 1; sz = 0; } else { sx = 0; sz = Math.sign(dz) || 1; } }
    } catch (e) {}
    // ★fluid-abort heading rotation (2026-07-02 13:07Z: 3 dispatches from the same cell all
    // aborted on the SAME flooded stair (44,61,160) — the heading is deterministic (+x when no
    // hostile), so every retry was identical and the kind burned into cooldown. Remember
    // fluid-aborted headings near this spot (TTL 10min, bot-object state per HANDOFF red line)
    // and start with the first cardinal that hasn't failed here yet.)
    try {
        const p0 = bot.entity.position;
        bot._mineDownFluidAvoid = (bot._mineDownFluidAvoid || []).filter(a => Date.now() - a.at < ABORT_HEADING_TTL_MS);
        const _rot = rotateAwayFromAborted(bot._mineDownFluidAvoid, p0, sx, sz);   // ★T-0139 shared/pinned
        const avoid = _rot.avoid;
        // ★T-0162 aquifer: ≥3 wet headings remembered here → relocate (tunnel) instead of staircasing the last one
        const _aqStart = aquiferHere(bot._mineDownFluidAvoid, p0) && bot.entity.position.y > targetY + 2;
        if (_aqStart) log_(`aquifer here (≥${AQUIFER_WET_HEADINGS} wet headings remembered) — relocating instead of descending the remaining heading`);
        if (_rot.rotated || _rot.exhausted || _aqStart) {
            const clean = (_rot.rotated && !_aqStart) ? [_rot.sx, _rot.sz] : null;
            if (clean) { sx = clean[0]; sz = clean[1]; log_(`heading rotated to ${sx},${sz} — ${avoid.length} fluid/void/wedge-aborted heading(s) remembered near here`); }
            // ★checkpoint#25 P1-A: only REFUSE on all-flooded headings when we still NEED to staircase
            // down — already at band (y<=targetY+2) the descent heading is moot (the at-band delegate
            // below hands off to branchMine, which has its own per-cell fluid guards), so stale fluid
            // memories from earlier descents must not block lateral mining at the band.
            else if (bot.entity.position.y > targetY + 2) {
                // ★P2-8c RELOCATE-THEN-RETRY (lever #1, 2026-07-07): every cardinal near here is
                // fluid/wedge-aborted → the descent CANNOT start from this cell, and honest-failing
                // just let the kernel re-dispatch onto the SAME dead cell (the ~40-50s发呆 loop). The
                // skill's own log begged "higher layer should relocate first" but nobody did it — so do
                // it HERE: move to fresh ground (>~6b clears the per-spot heading memory, which keys on
                // hypot<8) and re-derive a clean heading, then fall through to the descent this dispatch.
                // Guarded: only proceed if we actually moved AND landed on solid, dry footing AND a clean
                // cardinal opened up; otherwise honest-fail as before (the 3-strike cooldown still backs us).
                // reviewer#1: bound relocate hopping — ≤2 relocations per rolling 3-min window, else
                // honest-fail. Without this the per-spot heading memory (hypot<8) can't catch a bot that
                // hops ≥6b each time, so it would street-walk across a bad region (the 逛街 failure family).
                let rb = bot._mdRelocateBudget;
                if (!rb || Date.now() - rb.at > 180000) rb = bot._mdRelocateBudget = { at: Date.now(), count: 0 };
                if (rb.count >= 2) { log_(`relocate budget spent (${rb.count}/2 in <3min) — honest fail, higher layer should reposition`); return { failed: true, abort: 'all headings flooded/wedged; relocate budget spent' }; }
                const before = bot.entity.position.clone();
                // ★T-0161: underground the pathfinder moveAway never moved (0/∞ historically) — tunnel out instead.
                const _tun = planDryTunnel(bn, Math.floor(before.x), Math.round(before.y), Math.floor(before.z), targetY)   // ★T-0184
                    || planRelocateTunnel(bn, Math.floor(before.x), Math.round(before.y), Math.floor(before.z));
                let _fbOk = false;   // ★T-0193 the column walk reported arrival at a 5-solid-below column
                if (_tun) {
                    const _ok = await walkDugPath(bot, skills, Vec3, bn, _tun.path);
                    log_(`relocate tunnel ${_tun.sx},${_tun.sz} ×${_tun.path.length}${_tun.dryShaft ? ' (dry shaft)' : ''} — ${_ok ? 'arrived' : 'walk stopped early: ' + (bot._walkDugFail || '?')}`);
                    if (!_ok) _fbOk = await relocateFallback(bot, skills, bn, log_, 'tunnel walk stopped');
                } else {
                    // ★T-0193: moveAway underground moved 0.2b / hung 43s (live 00:04:25-30) — column walk or fast fail
                    _fbOk = await relocateFallback(bot, skills, bn, log_, 'no dry solid 9-cell tunnel line at this level');
                }
                // ★T-0193 post-check (live 00:35:52: 'path to solid column … arrived' then 'relocate failed (moved=5.1b
                //   footingOk=false)' — still stepping at arrival, and the column is ≥6b from the start minus the 2.5b
                //   arrival tolerance). Let the body settle ≤1s and accept ≥4b for a verified column arrival.
                if (_fbOk) { const _t0 = Date.now(); while (!bot.entity.onGround && Date.now() - _t0 < 1000) await new Promise(r => setTimeout(r, 100)); }
                const p2 = bot.entity.position;
                const movedB = Math.hypot(p2.x - before.x, p2.z - before.z);
                const feetB = bn(Math.floor(p2.x), Math.floor(p2.y) - 1, Math.floor(p2.z));
                const footingOk = feetB && feetB.boundingBox === 'block' && !FLUID.test(nm(feetB)) && !!bot.entity.onGround;
                const avoid2 = bot._mineDownFluidAvoid.filter(a => Date.now() - a.at < 600000 && Math.hypot(a.x - p2.x, a.z - p2.z) < 8);
                // ★T-0184 续: after a tunnel, the tunnel's own direction (its staircase was checked dry) comes first
                const _cands2 = (_tun ? [[_tun.sx, _tun.sz]] : []).concat([[1, 0], [0, 1], [-1, 0], [0, -1]]);
                // ★T-0184 回归修 (10-11 00:54-55: 6b dry-shaft tunnel lands inside the old spot's 8b memory → no clean heading → fail ×5):
                //   a verified dry staircase IS the clean heading.
                const clean2 = (_tun && _tun.dryShaft) ? [_tun.sx, _tun.sz] : _cands2.find(([cx, cz]) => !avoid2.some(a => a.sx === cx && a.sz === cz));
                if (movedB >= (_fbOk ? 4 : 6) && footingOk && clean2) {
                    sx = clean2[0]; sz = clean2[1];
                    rb.count++; rb.at = Date.now();
                    // suppress the bed-anchor pull below for ~90s — else it immediately pathfinds us
                    // right back to the all-aborted anchor cell we just escaped and lever#1 is a no-op.
                    try { bot._mdSkipBedAnchorUntil = Date.now() + 90000; } catch (e) {}
                    log_(`relocated ${movedB.toFixed(1)}b to fresh ground @${Math.round(p2.x)},${Math.round(p2.z)} — retry descent heading=${sx},${sz} (lever#1, relocate ${rb.count}/2)`);
                } else {
                    log_(`relocate failed (moved=${movedB.toFixed(1)}b footingOk=${footingOk} cleanHeading=${!!clean2}) — honest fail, higher layer should reposition`);
                    return { failed: true, abort: 'all headings flooded/wedged; relocate failed' };
                }
            }
            else { log_('all 4 headings fluid/wedge-aborted near here — but already at band; branchMine delegate owns fluid safety laterally'); }
        }
    } catch (e) {}

    log_(`START pos=${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)} hp=${Math.round(bot.health)} food=${bot.food} heading=${sx},${sz} targetY=${targetY}`);
    let dug = 0, ore = 0, abort = null, noProg = 0;
    let voidHops = 0;   // ★T-0137② in-dispatch void hops (≤3)
    let voidBridges = 0;   // ★T-0139 reopened: cave steps bridged / dropped this dispatch (≤48)
    let reflexWaits = 0;   // ★T-0267 steps held by a reflex this dispatch (≤REFLEX_STEP_WAITS_MAX)
    let fluidTurns = 0, loopRelocates = 0, cavityTurns = 0, deferredByShooter = false;   // ★T-0225 deferredByShooter   // ★T-0162 in-dispatch fluid re-heading (≤4) + tunnel relocate (≤1); ★T-0203 cavity re-heading (≤3)
    // walk the planned hop line cell by cell (break feet/head blocks like wedgeSidestep), true if we arrived
    const walkVoidHop = (path) => walkDugPath(bot, skills, Vec3, bn, path);

    // ★C248b mid-dive pickaxe-survival guard (root-harden — see memory resource-floor-bootstrap-kit).
    // C248 gates the DISPATCH (don't start a dive on a dying lone pick), but a pick that starts
    // healthy can still snap mid-dive (a 14-step staircase digs ~42 blocks > a worn wooden pick's
    // ~30 uses). Digging on past the snap strands a no-pick bot deeper in stone = the y66 tomb.
    // So each step: if the lone pick is about to break AND we can't craft a replacement, ABORT
    // now (still has a few uses to climb back; higher layer then surfaces for wood).
    const invCount = (re) => bot.inventory.items().filter(it => re.test(it.name || '')).reduce((s, it) => s + it.count, 0);
    // ★T-0139: plain filler for a stair support over a cave (never ores/logs/planks the tier chain needs)
    const bridgeBlockName = () => ['cobblestone', 'cobbled_deepslate', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'deepslate', 'netherrack']
        .find(n => invCount(new RegExp(`^${n}$`)) > 0) || null;
    // ★2026-07-05 用户令1: 地底隧道直通床区 — 床锚 10-48b 内 → 井口设在家门口, 竖井天然
    //    通家 (死亡重生即矿口, 免地表折返税)。>48b 不折返 (远征矿有自己的语境)。
    try {
        const lmB = bot._world && bot._world.landmarks && bot._world.landmarks.bed;
        if (lmB && Number.isFinite(lmB.x)) {
            const dB = Math.hypot(lmB.x - bot.entity.position.x, lmB.z - bot.entity.position.z);
            const skipBed = bot._mdSkipBedAnchorUntil && Date.now() < bot._mdSkipBedAnchorUntil;
            // reviewer#2: the pull is a near-SURFACE entrance step. dB is horizontal-only, so once the bot
            // has committed to a shaft below the bed level it would otherwise re-fire forever and yank a
            // mid-descent bot sideways/up back over the anchor. Don't pull home once we're >4b below the bed.
            const belowBed = Number.isFinite(lmB.y) && bot.entity.position.y < lmB.y - 4;
            if (skipBed) {
                // ★lever#1 exception: the anchor cell was all-headings-aborted and we relocated off it.
                // Honor that relocation (mine the fresh shaft) instead of yo-yoing back to the dead cell.
                // Narrow, logged, time-boxed override of 用户令 "隧道直通床区" — only when the anchor is undiggable.
                log_('bed-anchor pull skipped — recently relocated off an all-aborted anchor cell (lever#1); mining the fresh shaft');
            } else if (!belowBed && dB > 10 && dB <= 48) {
                log_(`bed-first entrance: 床锚 ${Math.round(dB)}b — 井口设在家 (用户令: 隧道直通床区)`);
                await Promise.race([
                    skills.goToPosition(bot, lmB.x, null, lmB.z, 6),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('bed-first-timeout')), 45000)),
                ]).catch(() => { try { bot.pathfinder.stop(); } catch (e) {} try { bot.clearControlStates(); } catch (e) {} });
            }
        }
    } catch (e) {}

    // ★2026-07-05 石镐 fodder 就地再造 (铁镐#3/#4 各 ~15min 阵亡实录: 分层守卫只会"装备
    // 现有石镐", 石镐断供后铁镐即裸奔凿石 — canFieldCraftPick 谓词遍地都是, 执行端一直缺位)。
    // 入口: 无石镐且材料齐(圆石3/棍2) → craftRecipeLocal 就地造 (自带口袋台放置+T-0079 回收)。
    try {
        const _hasStone = bot.inventory.items().some(i => i.name === 'stone_pickaxe');
        if (!_hasStone && invCount(/^cobblestone$/) >= 3 && invCount(/^stick$/) >= 2) {
            // ★T-0264 (live 04:46:34/43Z y18, one wooden pick left, no table in the pack → 'fail' ×2): craftRecipeLocal only
            //   places a CARRIED table — make one from planks (planks from a log first) before the 3x3 recipe.
            await ensureCarriedTable({
                counts: () => { const c = {}; try { for (const it of bot.inventory.items()) c[it.name] = (c[it.name] || 0) + it.count; } catch (e) {} return c; },
                craftLocal: (name, n) => skills.craftRecipeLocal(bot, name, n),
                nearTable: () => { try { return !!(ctx.world && ctx.world.getNearestBlock(bot, 'crafting_table', 4)); } catch (e) { return false; } },
                log: log_,
            }).catch(() => false);
            await skills.craftRecipeLocal(bot, 'stone_pickaxe', 1).catch(() => {});
            log_(`fodder-recraft: stone_pickaxe → ${bot.inventory.items().some(i => i.name === 'stone_pickaxe') ? 'OK' : 'fail'} (保铁镐不碰石)`);
        }
    } catch (e) {}
    // The predicate math now lives in the shared skills.pickRunway (one tool-durability
    // budget for the descent gate, TOOL_UPKEEP proposal, and every dig loop — the local
    // copies here were the original but drifted from modes.js's kit variant; the shared
    // canFieldCraftPick is stone-strict where the old local allowed a planks-head wooden
    // fallback — stricter aborts a step earlier, the safe direction).
    const pickAboutToBreak = () => skills.pickRunway(bot).aboutToBreak;
    const canCraftPick = () => skills.pickRunway(bot).canFieldCraftPick;

    // ★P0-1 回程预算前置门 (review-2026-07-04-distance.md: 铁镐三落三起, >18h 无铁镐).
    // 中途版 C248b 只在挖矿开始后逐步检查 — 一把 <15% 耐久的孤镐照样通过入口开挖, 断在
    // 半路 = 深处无镐 + 无替补材料的经典开局. 入口即检: 孤镐将死 + planksEq<4 (现场连
    // 木镐柄都造不出) → 直接 return false (真零进度), kernel 冷却后补给类提案
    // (REPLENISH_KIT, 并行在建) 接得上手. 有备镐或有木料的照旧放行 (中途版守卫保留).
    try {
        const picks = bot.inventory.items().filter(it => /_pickaxe$/.test(it.name || ''));
        if (picks.length === 1) {
            const it = picks[0];
            const max = it.maxDurability || 0;
            const used = (typeof it.durabilityUsed === 'number') ? it.durabilityUsed : 0;
            const leftPct = max > 0 ? (max - used) / max : 1;   // 未知耐久=不恐慌 (同 skills.pickRunway)
            const planksEq = invCount(/_planks$/) + invCount(/_log$/) * 4;
            // canFieldCraftPick 是"现场造得出替补"的精确谓词 (带台+棍+石也行) — planksEq<4 只是
            // 木料侧粗筛, 两者都不行才 yield, 免得错杀带全套材料的健康派发.
            if (leftPct < 0.15 && planksEq < 4 && !canCraftPick()) {
                log_(`NO-RETURN-BUDGET yield (pick dying, no spare, no planks) — ${it.name} ${(leftPct * 100).toFixed(0)}% left, planksEq=${planksEq}`);
                return false;
            }
        }
    } catch (e) {}

    // ★KERNEL-CONTRACT entry snapshot (return-contract audit 2026-07-02): the final return judges
    // REAL progress this dispatch against these — y actually descended, or net ore units gained.
    // Hoisted from the at-depth loop so both the loop's stall judge and the return judge read one
    // definition. Do NOT trust `dug` for this: it historically counted air no-ops. Widened with
    // coal|emerald (branchMine's set has them; the old set missed the ITEM drops of coal_ore,
    // which IS in ORE above — a coal-only productive run must not judge as zero-progress).
    const oreUnits = () => invCount(/^raw_iron$/) + invCount(/^raw_copper$/) + invCount(/^raw_gold$/)
        + invCount(/^(iron_ore|deepslate_iron_ore|gold_ore|deepslate_gold_ore|redstone|lapis_lazuli|diamond|coal|emerald)$/)
        + invCount(/_ore$/);
    const entryY = Math.round(bot.entity.position.y);
    const oreUnitsAtEntry = oreUnits();
    const cobbleUnits = () => invCount(/^(cobblestone|cobbled_deepslate)$/);   // ★T-0198
    const cobbleAtEntry = cobbleUnits();

    // ★2026-07-08 到层背包满就地清理 (钻石"够不到"根因 4, 见 [[diamond-never-reached-blocker-stack]]):
    //   实录 bot 抵 targetY 后 'pack full (free=1) — stop at-depth mining' ×4 + 'diamondBank: no chest
    //   available' → 到了矿层却因满包不挖。像真玩家那样丢弃【过量低值填料】腾格续挖: 保留足量圆石/深板岩
    //   作封壁料 (mineDiamonds sealLevel/tunnelAside 要用), 矿石(raw_*/煤/钻/青金/红石/铁/金)永不丢。
    //   bounded (每类只丢超储备部分)、不 throw、腾出 >2 空格即早停。
    const _DECLUTTER_KEEP = { cobblestone: 128, cobbled_deepslate: 64, dirt: 16 };
    const _DECLUTTER_JUNK = ['cobblestone', 'cobbled_deepslate', 'deepslate', 'tuff', 'andesite', 'diorite', 'granite', 'dirt', 'gravel', 'netherrack'];
    const declutterAtDepth = async () => {
        let tossed = 0;
        for (const name of _DECLUTTER_JUNK) {
            try {
                const items = bot.inventory.items().filter(it => it.name === name);
                const have = items.reduce((s, it) => s + it.count, 0);
                let surplus = have - (_DECLUTTER_KEEP[name] || 0);
                if (surplus <= 0) continue;
                for (const it of items) {
                    if (surplus <= 0) break;
                    const n = Math.min(it.count, surplus);
                    try { await bot.toss(it.type, null, n); tossed += n; surplus -= n; } catch (e) {}
                    await new Promise(r => setTimeout(r, 80));
                }
                let f = 0; try { f = bot.inventory.emptySlotCount(); } catch (e) {}
                if (f > 2) break;
            } catch (e) {}
        }
        return tossed;
    };

    // ★checkpoint#25 P1-A AT-BAND DELEGATE (06:53:58-06:54:03 实录: bot 首次抵达 y=12 钻石带后,
    // 三次 mineDown 派发全部 {endY:12, dug:0, abort:null, failed:true} — 起点已在目标层, mineDown
    // 是"只下降"的技能, 下降 0 被 return-contract 判败 → 3 振 → DUSK_MINE_NIGHT 冷却在钻石层
    // 正上方 → bot 上浮放弃 → 钻石 0)。已在带内 (y <= targetY+2) 时正确动作不是"再下降", 而是
    // 转入 branchMine 支线采矿 — "mine through the night" 的本意。branchMine(bot,ctx,length,targetY)
    // 自带 lava/water/断镐/低食守卫 + C305 反 x-ray 可达门 + 自己的净进度返回契约 (真进度 truthy /
    // 零进度 false), 这里按原契约透传其返回: 有进展 → kernel 保持 commitment 再派 (下一派仍 at-band
    // → 再 branchMine, 即整夜带内轮采); 零进展 → 诚实 failed:true 进冷却 (是"没挖到"的真败, 不再是
    // "没下降"的假败)。branchMine 不可用/抛错 → 退而求其次: 本轮净矿增益或实际下降 → truthy,
    // 纯零进展仍 failed:true (诚实)。entry snapshot (entryY/oreUnitsAtEntry) 语义未破坏 — fallback
    // 判据仍读它; abort 语义未破坏 — 委派路径 abort=null (无楼梯步, 无 abort 源)。
    if (bot.entity.position.y <= targetY + 2) {
        log_(`at-band start (y=${entryY} <= targetY+2=${targetY + 2}) — delegating to branchMine (lateral ore mining), not judging by descent`);
        let bmOk = null;   // true/false = branchMine's own contract verdict; null = unavailable/threw → local fallback judge
        if (typeof skills.customSkill === 'function') {
            try { bmOk = !!(await skills.customSkill(bot, 'branchMine', 24, targetY)); }
            catch (e) { bmOk = null; log_(`branchMine threw: ${e && e.message || e} — falling back to local progress judge`); }
        } else {
            log_('skills.customSkill unavailable — falling back to local progress judge');
        }
        let inv = {}; try { for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count; } catch (e) {}
        const r = { endY: Math.round(bot.entity.position.y), dug, oreVeins: ore, hp: Math.round(bot.health), food: bot.food,
                    abort, raw_iron: inv.raw_iron || 0, iron_ore: 0, atBand: true, delegated: 'branchMine', bmReturn: bmOk };
        // Fallback judge mirrors the file's KERNEL-CONTRACT: real ore units gained or real descent.
        // (In the delegate path mineDown's own dug/ore stay 0 — branchMine digs internally — so the
        // observable local progress is picked-up ore units / y actually descended.)
        const localProgress = (entryY - r.endY) >= 1 || oreUnits() > oreUnitsAtEntry;
        const progressed = bmOk === null ? localProgress : bmOk;
        if (!progressed) r.failed = true;
        log_(`DONE ${JSON.stringify(r)} (at-band delegate: bm=${bmOk} localProgress=${localProgress})`);
        return r;
    }

    // ★P2-8 幽灵格楔死恢复 (2026-07-04 05:23Z 实录 @123,57,134 heading=1,0: DIAG 显示前方
    // (124,56-58,134) 全是 air、breakResults 全 false, 但 afterWalk 每步只挪 dx=0.04 —— 客户端
    // 视界里是空气的格子在服务器端是实心 (ghost block/视界不同步), 低层 walk 物理撞墙.
    // 旧逻辑 'no descent — wedged 2 steps' 诚实 fail → 冷却 → 重派同格同 heading 再楔, 永动).
    // 恢复链: ①重读撞墙格 (bot.world + blockAt), 实为实心 → 补挖 (ghost 已刷新) 同向重试;
    // ②仍读 air → 记入技能级黑名单 bot._mdWedgeBlacklist (TTL 10min), 以后不再朝该列走;
    // ③heading 记忆从 fluid 扩到 wedge (推进 bot._mineDownFluidAvoid) + 垂直于 heading 侧移
    // 2-4 格后换未被记忆拒绝的 heading 重试 (每派发限 2 次); ④同点 (3b 内, 跨派发记忆) 第 3
    // 次楔死 → moveAway 8b 后诚实 fail (冷却 + 释放承诺, 让别的提案在新位置接手).
    let wedgeRecoveries = 0;
    let wedgeFinal = false;
    const wedgeSidestep = async () => {
        for (const [px, pz] of [[-sz, sx], [sz, -sx]]) {   // 垂直于当前 heading 的两个方向
            const start = bot.entity.position.clone();
            let blockedDir = false;
            for (let k = 0; k < 3 && !blockedDir; k++) {
                const c0 = bot.entity.position;
                const cyf = Math.floor(c0.y);
                const tx = Math.floor(c0.x) + px, tz = Math.floor(c0.z) + pz;
                const feetB = bn(tx, cyf, tz), headB = bn(tx, cyf + 1, tz), floorB = bn(tx, cyf - 1, tz);
                // 侧移目标列安全: 无流体、脚下有实心支撑 (不为逃楔死掉进洞/水)
                if (FLUID.test(nm(feetB)) || FLUID.test(nm(headB)) || FLUID.test(nm(floorB))) break;
                if (/^(air|cave_air|void_air)$/.test(nm(floorB))) break;
                // 实心格先挖开 (UNBREAKABLE 则此向放弃)
                for (const [bx, by, bz] of [[tx, cyf + 1, tz], [tx, cyf, tz]]) {
                    const b = bn(bx, by, bz);
                    if (b && b.boundingBox === 'block') {
                        if (UNBREAKABLE.test(b.name || '')) { blockedDir = true; break; }
                        try { await skills.breakBlockAt(bot, bx, by, bz); } catch (e) {}
                    }
                }
                if (blockedDir) break;
                try {
                    await bot.lookAt(new Vec3(tx + 0.5, cyf + 0.5, tz + 0.5), true);
                    bot.setControlState('forward', true);
                    const t0 = Date.now();
                    while (Date.now() - t0 < 1500) { const pp = bot.entity.position; if (Math.hypot(pp.x - (tx + 0.5), pp.z - (tz + 0.5)) < 0.45) break; await new Promise(r => setTimeout(r, 100)); }
                } finally { try { bot.setControlState('forward', false); } catch (e) {} }
                const adv = Math.hypot(bot.entity.position.x - c0.x, bot.entity.position.z - c0.z);
                if (adv < 0.5) break;   // 这向也撞墙 (可能又是幽灵格) → 试反向
                if (Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z) >= 2) break;   // 已侧移 2+ 格, 够了
            }
            const total = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z);
            if (total >= 1.5) { log_(`wedge sidestep moved ${total.toFixed(1)}b perp=${px},${pz}`); return true; }
        }
        return false;
    };
    // ★P2-8b ACTIVE GHOST-BUSTER (2026-07-07): the ORIGINAL recovery ① below re-reads the forward
    // column via bot.world.getBlock / bot.blockAt — but those read the SAME client chunk cache the
    // walk just wedged against, so a client-air/server-solid ghost re-reads as 'air' forever, ①
    // never fires, and we burn the heading straight into the blacklist (live 05:53Z & 06:01Z: every
    // dispatch aborted, GO_UNDERGROUND/DUSK_MINE_NIGHT into 5-min cooldown, bot发呆 in the trench).
    // Passive re-reads can't detect a desync — only INTERACTION forces the server to resend truth.
    // So: (a) back off ~0.5b to physically unwedge AND regain line-of-sight down-forward (a jammed
    // 1-wide body can't aim at the step it must break); guarded to only reverse onto a safe standing
    // cell (solid floor, open feet/head, no fluid) so we never back off a ledge or into water/lava.
    // (b) let ~250ms of block_change corrections land. (c) dig each forward cell — tool-aware
    // breakBlockAt for cells the client shows solid; a RAW bot.dig for cells it shows 'air' (breakBlockAt
    // refuses air, but a raw dig makes the server break the true ghost block and emit the corrective
    // update). Returns count of confirmed solid breaks. Bounded, best-effort, never throws.
    const forceUnghost = async (fx, cy, fz) => {
        if (bot.interrupt_code) return 0;   // ★yield fast to a supervisor cancel — don't hold the body in recovery
        try {
            const p0 = bot.entity.position;
            const bx = Math.floor(p0.x) - sx, bz = Math.floor(p0.z) - sz, by = Math.floor(p0.y);
            const bFloor = bn(bx, by - 1, bz), bFeet = bn(bx, by, bz), bHead = bn(bx, by + 1, bz);
            const openCell = (b) => !b || /^(air|cave_air|void_air)$/.test(nm(b));
            if (bFloor && bFloor.boundingBox === 'block' && !FLUID.test(nm(bFloor)) && openCell(bFeet) && openCell(bHead)) {
                await bot.lookAt(new Vec3(bx + 0.5, by + 0.5, bz + 0.5), true);
                bot.setControlState('back', true);
                const t0 = Date.now();
                while (Date.now() - t0 < 600 && Math.hypot(bot.entity.position.x - p0.x, bot.entity.position.z - p0.z) < 0.5) await new Promise(r => setTimeout(r, 60));
                try { bot.setControlState('back', false); } catch (e) {}
            }
        } catch (e) { try { bot.setControlState('back', false); } catch (e2) {} }
        await new Promise(r => setTimeout(r, 250));   // settle: let the server's block_change corrections apply
        let cleared = 0;
        for (const dy of [1, 0, -1]) {
            if (bot.interrupt_code) break;
            const b = bn(fx, cy + dy, fz);
            if (!b || FLUID.test(nm(b)) || UNBREAKABLE.test(nm(b))) continue;
            try { await bot.lookAt(new Vec3(fx + 0.5, cy + dy + 0.5, fz + 0.5), true); } catch (e) {}
            if (b.boundingBox === 'block') {
                try { if ((await skills.breakBlockAt(bot, fx, cy + dy, fz)) === true) cleared++; } catch (e) {}
            } else {
                // client shows air but the body is wedged here → dig the ghost the server still has.
                // The dig resolves only on a real blockUpdate; if the cell is truly air on both sides it
                // never resolves, so the 2s race abandons it — stopDigging() then clears the leaked
                // targetDigBlock / swingInterval / blockUpdate listener so it can't fight the next walk.
                try { const dp = bot.dig(b, true); dp.catch(() => {}); await Promise.race([dp, new Promise(r => setTimeout(r, 2000))]); }
                catch (e) {}
                finally { try { bot.stopDigging(); } catch (e) {} }
            }
        }
        return cleared;
    };
    const wedgeRecover = async (fx, cy, fz) => {
        if (kernelYieldRequested(bot, mdEnteredAt)) return 'kernel-flip';   // ★T-0190 don't run a 14s recovery chain the caller cancelled
        const p = bot.entity.position;
        // ④ 同点第 3 次楔死 (跨派发记忆, TTL 10min) → moveAway 8b + 诚实 fail
        try {
            bot._mdWedgeSpots = (bot._mdWedgeSpots || []).filter(s => Date.now() - s.at < 600000);
            let spot = bot._mdWedgeSpots.find(s => Math.hypot(s.x - p.x, s.z - p.z) < 3);
            if (spot) { spot.count++; spot.at = Date.now(); } else { spot = { x: p.x, z: p.z, count: 1, at: Date.now() }; bot._mdWedgeSpots.push(spot); }
            if (spot.count >= 3) {
                log_(`wedge x${spot.count} at same spot ${Math.round(p.x)},${Math.round(p.z)} — moveAway 8b + honest fail (cooldown, other proposals take over)`);
                try { await skills.moveAway(bot, 8); } catch (e) {}
                return 'wedge-final';
            }
        } catch (e) {}
        // ⓪ ★P2-8b: force a real server re-sync BEFORE the passive re-read/blacklist below. After it,
        // re-read the forward step — the raw air-dig + settle may have opened it even when breakBlockAt
        // reported nothing (server-solid ghost cleared via the corrective block_change). Counts against
        // the same 2/dispatch budget as the sidestep so it can never loop unbounded.
        if (wedgeRecoveries < 2) {
            const cleared = await forceUnghost(fx, cy, fz);
            const f2 = bn(fx, cy - 1, fz), h2 = bn(fx, cy, fz);
            // truly-empty only: a slab/stairs/snow_layer (boundingBox!=='block') still physically wedges a
            // 1.8-tall body, so DON'T count it as open — else a non-ghost wedge burns both budgets re-walking it.
            const open2 = (b2) => !b2 || /^(air|cave_air|void_air)$/.test(nm(b2));
            if (cleared > 0 || (open2(f2) && open2(h2))) {
                wedgeRecoveries++;
                try { bot._mdWedgeBlacklist = (bot._mdWedgeBlacklist || []).filter(e2 => !(e2.x === fx && e2.z === fz && Math.abs(e2.y - cy) <= 3)); } catch (e) {}
                log_(`ghost-buster: resync cleared=${cleared} fwdOpen=${open2(f2) && open2(h2)} — retry same heading (recovery ${wedgeRecoveries}/2)`);
                return 'retry';
            }
        }
        // ① 撞墙格重查询: 客户端说 air 但物理撞墙 → bot.world/blockAt 重读, 实为实心 = ghost 已刷新, 补挖后同向重试
        let ghostDug = 0;
        for (const dy of [1, 0, -1]) {
            let b = null;
            try { b = (bot.world && typeof bot.world.getBlock === 'function') ? bot.world.getBlock(new Vec3(fx, cy + dy, fz)) : null; } catch (e) {}
            if (!b) b = bn(fx, cy + dy, fz);
            if (b && b.boundingBox === 'block' && !FLUID.test(b.name || '') && !UNBREAKABLE.test(b.name || '')) {
                log_(`wedge re-dig: re-read (${fx},${cy + dy},${fz})=${b.name} (walked into it as 'air') — digging the ghost`);
                try { const r = await skills.breakBlockAt(bot, fx, cy + dy, fz); if (r === true) ghostDug++; } catch (e) {}
            }
        }
        if (ghostDug > 0) {
            // 补挖成功 = 该列已打通, 摘除旧黑名单条目, 否则 retry 同向下一步立刻撞自己的黑名单白烧 sidestep 预算
            try { bot._mdWedgeBlacklist = (bot._mdWedgeBlacklist || []).filter(e2 => !(e2.x === fx && e2.z === fz && Math.abs(e2.y - cy) <= 3)); } catch (e) {}
            log_(`wedge re-dig cleared ${ghostDug} ghost block(s) — blacklist entry removed, retry same heading`);
            return 'retry';
        }
        // ② 重读仍全 air → 从这里破不掉的服务器端幽灵列, 记入黑名单 (TTL 10min)
        try {
            bot._mdWedgeBlacklist = (bot._mdWedgeBlacklist || []).filter(e2 => Date.now() - e2.at < 600000);
            if (!bot._mdWedgeBlacklist.some(e2 => e2.x === fx && e2.z === fz && Math.abs(e2.y - cy) <= 2)) {
                bot._mdWedgeBlacklist.push({ x: fx, y: cy, z: fz, at: Date.now() });
            }
            log_(`wedge-blacklist (${fx},${cy},${fz}) — reads air but body can't enter (ghost/desync), TTL 10min, entries=${bot._mdWedgeBlacklist.length}`);
        } catch (e) {}
        // ③ heading 记忆扩到 wedge (原来只 fluid 换向) + 强制侧移换向重试
        try { (bot._mineDownFluidAvoid = bot._mineDownFluidAvoid || []).push({ x: p.x, z: p.z, sx, sz, at: Date.now(), why: 'wedge' }); } catch (e) {}
        if (wedgeRecoveries >= 2) { log_('wedge sidestep budget spent (2/dispatch) — honest fail'); return 'no-sidestep-budget'; }
        wedgeRecoveries++;
        if (!(await wedgeSidestep())) { log_('wedge sidestep failed (both perpendicular dirs blocked) — honest fail'); return 'sidestep-blocked'; }
        try {
            const p1 = bot.entity.position;
            const avoid = (bot._mineDownFluidAvoid || []).filter(a => Date.now() - a.at < 600000 && Math.hypot(a.x - p1.x, a.z - p1.z) < 8);
            const clean = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([cx2, cz2]) => !avoid.some(a => a.sx === cx2 && a.sz === cz2));
            if (clean) { sx = clean[0]; sz = clean[1]; }
            else { sx = -sx; sz = -sz; }   // 四向都有记忆 → 至少调头, 别再撞同一列
            log_(`wedge sidestep ok — retry with heading=${sx},${sz} (recovery ${wedgeRecoveries}/2)`);
        } catch (e) {}
        return 'retry';
    };

    // ★DESCEND-TOLERANCE (worker-frozen 0701, T-0110): branch-mine once we're CLOSE to targetY, not only
    // at the exact depth. Live depth-churn: bot pinned @48,17 (targetY=14) — it could not descend the last
    // ~3 blocks (staircase 'no descent — wedged': digs the stair but the step-down walk fails), so cy(17)
    // stayed > targetY(14) forever → it NEVER fell through to branchMine → mineDown returned 'no descent'
    // every ~1.5s, kernelDriver re-dispatched, and the depth-gate (rightly) blocked the surface-migrate
    // escape → the bot froze at the iron band mining nothing until a 25min watchdog restart. y14-20 is all
    // prime iron band, so branch-mining at y≈17 is fully productive for the iron goal (diamonds get their
    // own mineDiamonds@y-11). Tolerance = 6 blocks above targetY.
    const DESCEND_TOLERANCE = descendTolerance(Math.round(bot.entity.position.y), targetY);   // ★T-0187 (was a flat 6)
    // ★2026-07-09 用户令 "以怪为基准做 hazard 感知, 不用管空腔; 只有怪在附近才特别注意": 台阶是双向敞开
    //   的走廊 — 挖进空洞/黑腔无所谓(怪不在就照挖), 但挖进【有活怪】的洞就是给怪修上行高速。故下潜途中
    //   逐步复查: HOSTILE_STEER_R 内有敌对怪且当前 heading 正朝它挖(或怪贴到点前) → 把楼梯拐向背离怪的
    //   基点(复用 START 的 away-from-hostile 推导 + fluid/wedge 换向记忆, 不撞已知流体/楔死列)。无怪 →
    //   一律不动, 照常直挖。贴到臂展(<4b)来不及拐的兜底 yield 仍在循环体里(交给 self_defense 反射)。
    const HOSTILE_STEER_R = 10;
    const steerFromHostile = () => {
        try {
            const p = bot.entity.position;
            let best = null, bd = Infinity;
            for (const e of Object.values(bot.entities || {})) {
                if (!(e && e !== bot.entity && e.position && ctx.mc.isHostile(e))) continue;
                const d = e.position.distanceTo(p);
                if (d < bd) { bd = d; best = e; }
            }
            if (!best || bd > HOSTILE_STEER_R) return;
            const dx = p.x - best.position.x, dz = p.z - best.position.z;   // bot − mob (points AWAY from mob)
            const toward = (sx * -dx + sz * -dz) > 0;                        // heading · (mob − bot) > 0 = 正朝怪挖
            if (!toward && bd >= 5) return;                                  // 没朝怪挖且非点前 → 台阶保持不动
            let ax, az;                                                      // away-heading = 背离怪的主轴 (镜像 START)
            if (Math.abs(dx) >= Math.abs(dz)) { ax = Math.sign(dx) || 1; az = 0; } else { ax = 0; az = Math.sign(dz) || 1; }
            let cand = [ax, az];
            const avoid = (bot._mineDownFluidAvoid || []).filter(a => Date.now() - a.at < 600000 && Math.hypot(a.x - p.x, a.z - p.z) < 8);
            const blocked = ([cx2, cz2]) => avoid.some(a => a.sx === cx2 && a.sz === cz2);
            if (blocked(cand)) {   // away-heading 撞已知流体/楔死记忆 → 退而取任一"非朝怪"的干净基点
                const alt = [[1, 0], [0, 1], [-1, 0], [0, -1]].filter(([cx2, cz2]) => (cx2 * -dx + cz2 * -dz) <= 0 && !blocked([cx2, cz2]));
                if (!alt.length) return;                                     // 没有干净的背怪方向 → 交给 4b bail / 流体逻辑收尾
                cand = alt[0];
            }
            if (cand[0] === sx && cand[1] === sz) return;                    // 已经就是背怪基点
            sx = cand[0]; sz = cand[1];
            log_(`hostile-steer: ${best.name || 'mob'} @${bd.toFixed(1)}b — 拐向背离怪 heading=${sx},${sz} (以怪为基准, 不把台阶挖进怪堆)`);
        } catch (e) {}
    };
    for (let i = 0; i < steps; i++) {
        if (kernelYieldRequested(bot, mdEnteredAt)) { abort = 'kernel commitment flipped — yield (T-0190)'; break; }   // live 23:26: 17s late
        const cur = bot.entity.position;
        const cy = Math.round(cur.y);
        // ★T-0174: head under water / air running out → stop mining NOW, give the body to the swim/escape
        // reflexes (death #10: kept chipping stone underwater while the rescue dig couldn't get the slot).
        try {
            const _hb = bot.blockAt(cur.floored().offset(0, 1, 0));
            const _fb = bot.blockAt(cur.floored());
            // ★T-0174 hotfix (23:03 live: dry land y68 hp20 but bot.oxygenLevel stale at -1..2 after a drowning death →
            //   mineDown aborted 3× → GO_UNDERGROUND cooldown). O2 only counts while the body is actually in water.
            const _headW = /water/.test((_hb && _hb.name) || ''), _feetW = /water/.test((_fb && _fb.name) || '');
            if (_headW || (_feetW && Number.isFinite(bot.oxygenLevel) && bot.oxygenLevel < 12)) {
                rememberAbortedHeading(bot, sx, sz);
                abort = `head in water / O2=${bot.oxygenLevel} — stop mining, yield to swim/escape (T-0174)`;
                break;
            }
        } catch (e) {}
        if (cy <= targetY + DESCEND_TOLERANCE) {
            // ★AT-DEPTH NO-OP FREEZE FIX (live y12 pin 450s+): mineDown ONLY descends, so once it reaches
            //   targetY it returns instantly and the proposer (GO_UNDERGROUND/DUSK_MINE_NIGHT) re-dispatches
            //   it → no-op every ~1.5s → the bot freezes at the bottom of the iron band having mined NO ore
            //   (live: y12, coal but 0 raw_iron). Fall through to branchMine — a horizontal ore tunnel
            //   (its own lava/water guards) — so the bot actually MINES iron/diamond at the band.
            // ★T-0092 AT-DEPTH BRANCH LOOP: a SINGLE branchMine(24) then return wasn't enough — the
            //   proposer re-dispatched, branchMine re-tunnelled the same dead-end, and the bot空转 at
            //   the band底. Instead LOOP branchMine here with a NET-PROGRESS judge: keep tunnelling for
            //   ore until either (a) no new ore came in over the last 2 rounds (this seam is mined out →
            //   return so a fresh dispatch starts a new heading/depth), (b) the pack is full (go bank),
            //   or (c) the pick is about to snap with no recraft (don't strand deep). This makes
            //   descend-then-MINE-OUT the productive unit instead of descend-then-touch-and-leave.
            // (oreUnits hoisted to function entry — return-contract audit 2026-07-02.)
            let lastUnits = oreUnits(), stallRounds = 0, rounds = 0;
            log_(`reached targetY=${targetY} at step ${i} — branch-mining loop for ore (oreUnits=${lastUnits})`);
            while (rounds++ < 8) {
                if (bot.interrupt_code) { abort = 'interrupted at-depth branch loop'; break; }
                // pack full → 先就地清理过量填料腾格续挖 (根因 4); 清完仍满才停交上层 bank。
                let free = 36; try { free = bot.inventory.emptySlotCount(); } catch (e) {}
                if (free <= 1) {
                    let freed = 0; try { freed = await declutterAtDepth(); } catch (e) {}
                    let free2 = free; try { free2 = bot.inventory.emptySlotCount(); } catch (e) {}
                    if (free2 <= 1) { log_(`pack full (free=${free2}) after declutter — stop at-depth mining (bank)`); break; }
                    log_(`at-depth declutter freed slots (free ${free}→${free2}, tossed ${freed} junk) — keep mining`);
                }
                // pick guard: about to break + can't recraft → return before stranding deep.
                if (pickAboutToBreak() && !canCraftPick()) { log_('pick about to break + no recraft — stop at-depth mining'); break; }
                try { await skills.customSkill(bot, 'branchMine', 24); } catch (e) { log_(`branchMine threw: ${e && e.message || e}`); break; }
                const now = oreUnits();
                if (now > lastUnits) { stallRounds = 0; lastUnits = now; }
                else { stallRounds++; if (stallRounds >= 2) { log_(`no new ore over ${stallRounds} rounds (oreUnits=${now}) — seam mined out, return for fresh dispatch`); break; } }
            }
            break;
        }
        // ★以怪为基准: 先尝试把这一步的 heading 拐离近怪 (10b 内且正朝怪挖) — 提前避, 别等贴脸。
        steerFromHostile();
        // ★T-0225: a shooter that sees us — wall off its line of sight here, then keep digging; can't → stop and hand the
        //   body to self_defense / self_preservation (deferred, not a strike).
        const _shooter = shooterToCover(bot, 10);
        if (_shooter) {
            let _cv = null;
            if (typeof skills.coverFromShooter === 'function') { try { _cv = await skills.coverFromShooter(bot, _shooter, { tag: 'mineDown' }); } catch (e) {} }
            if (_cv && _cv.covered) log_(`shooter ${_shooter.name} in view — covered its line of sight (placed ${_cv.placed}), continuing (T-0225)`);
            else {
                deferredByShooter = true;
                abort = `${_shooter.name} in view ≤10b, line of sight not covered (${_cv ? (_cv.why || 'still exposed') : 'no cover primitive'}) — yield to self_defense (T-0225)`;
                break;
            }
        }
        // bail to survival if an actionable hostile got close (shouldn't in a sealed stair, but guard)
        try {
            // ★T-0243 (T-0242): 与决策层同一谓词 (hostile_reach.hostileRawNear, 4 格内原始敌对不看可达) — 决策层也据此不派/释放下挖, 不再 1.5s 派发↔让位
            const close = hostileRawNear(bot, DESCENT_HOSTILE_R) > 0;
            if (close) { abort = 'hostile within 4 — yield to survival'; break; }
        } catch (e) {}
        // ★C248b: stop before the only pick snaps with no replacement → don't strand deeper.
        if (pickAboutToBreak() && !canCraftPick()) { abort = `pick about to break + no replacement (planks=${invCount(/_planks$/)} logs=${invCount(/_log$/)} cobble=${invCount(/^(cobblestone|cobbled_deepslate)$/)} stick=${invCount(/^stick$/)}) — stop before stranding`; break; }

        // ★ROOT-CAUSE FIX (-22,82,10 live pin): block cells use floor(), NOT round(). At
        // x=-22.30 the bot is physically in cell floor=-23, but round=-22 → mineDown dug the
        // forward staircase one cell off from where the bot actually stood, so the bot wedged
        // against the undug side wall and never advanced (live evidence: 40 steps, dug=93, pos
        // pinned -22,82,10, walk "moved dx=0", and agent.log spamming "Skipping block ...because
        // it is air" — it kept re-digging an already-empty column 1 cell away from the body).
        // round≠floor whenever frac>0.5 or coord<0 — exactly this negative-coord food-desert pocket.
        const cx = Math.floor(cur.x), cz = Math.floor(cur.z);
        const fx = cx + sx, fz = cz + sz;                  // forward column
        // ★P2-8 黑名单前进列: 这一列此前楔死过 (客户端 air/服务器实心) → 不再朝它走, 直接进恢复链换向
        try {
            bot._mdWedgeBlacklist = (bot._mdWedgeBlacklist || []).filter(e2 => Date.now() - e2.at < 600000);
            if (bot._mdWedgeBlacklist.some(e2 => e2.x === fx && e2.z === fz && Math.abs(e2.y - cy) <= 3)) {
                log_(`wedge-blacklist hit at forward (${fx},${cy},${fz}) — recover without re-wedging`);
                const handled = await wedgeRecover(fx, cy, fz);
                if (handled === 'retry') { noProg = 0; continue; }
                if (handled === 'wedge-final') wedgeFinal = true;
                abort = `forward column blacklisted (ghost) at ${fx},${cy},${fz} (${handled}); yield`;
                break;
            }
        } catch (e) {}
        // DESCEND-forward: the new standing cell is ONE block down-and-forward. New feet at
        // (fx,cy-1,fz), new head at (fx,cy,fz), plus (fx,cy+1,fz) headroom. The support under
        // the new feet is (fx,cy-2,fz) and MUST stay solid or the bot free-falls.
        const newFeet = bn(fx, cy - 1, fz), newHead = bn(fx, cy, fz), clear = bn(fx, cy + 1, fz);
        const support = bn(fx, cy - 2, fz);
        // ★C311 (T-0048): was lava-only; now lava+water — an aquifer floods the stair from the
        // SIDE (not just the cell we break), the recurring deep drowning (#112). Same ring, both fluids.
        let fluidNear = false;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [0, -2, 0]]) {
            if (/lava|water/.test(nm(bn(fx + dx, cy - 1 + dy, fz + dz)))) { fluidNear = true; break; }
        }
        const safe = stairSafety({ feet: nm(newFeet), head: nm(newHead), floor: nm(support), fluidNear });
        if (!safe.safe) {
            abort = `unsafe at ${fx},${cy - 1},${fz}: ${safe.reason}`;
            // feed the heading-rotation memory (see START) so the next dispatch tries a different way
            if (/fluid/.test(safe.reason || '')) {
                rememberAbortedHeading(bot, sx, sz, Date.now(), 'fluid');
                // ★T-0162: one heading per dispatch meant three wet headings = three zero-dig dispatches = kernel
                //   3-strike cooldown before the 4th heading / T-0161 tunnel relocate ever ran (live 20:22:59).
                //   Re-head (and if every cardinal is wet here, tunnel out) inside THIS dispatch instead.
                const _r = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, sx, sz);
                const _aq = aquiferHere(bot._mineDownFluidAvoid, bot.entity.position);   // death #10: 3 wet sides → leave
                if (_aq) log_(`aquifer: ${AQUIFER_WET_HEADINGS}+ wet headings here — tunnel out instead of descending the last one`);
                if (_r.rotated && fluidTurns < 4 && !_aq) {
                    fluidTurns++;
                    log_(`fluid turn ${fluidTurns}/4: heading ${sx},${sz} → ${_r.sx},${_r.sz} (fluid near ${fx},${cy - 1},${fz})`);
                    sx = _r.sx; sz = _r.sz; noProg = 0;
                    continue;
                }
                if ((_r.exhausted || _aq) && loopRelocates < 1) {
                    const _tun = planDryTunnel(bn, cx, cy, cz, targetY) || planRelocateTunnel(bn, cx, cy, cz);   // ★T-0184 dry shaft first
                    if (!_tun) log_(`fluid: all 4 headings wet here and no dry 9-cell tunnel line at y${cy}`);
                    else if (!(await walkDugPath(bot, skills, Vec3, bn, _tun.path))) { loopRelocates++; log_(`fluid: tunnel ${_tun.sx},${_tun.sz} walk stopped early: ${bot._walkDugFail || '?'}`); }
                    else {
                        loopRelocates++;
                        // ★T-0184 续: keep going the tunnel's way (the dry staircase was checked along it), not back toward the aquifer
                        const _r2 = _tun.dryShaft ? { sx: _tun.sx, sz: _tun.sz } : rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, _tun.sx, _tun.sz);
                        sx = _r2.sx; sz = _r2.sz; noProg = 0;
                        log_(`fluid: all 4 headings wet here — tunnelled ${_tun.path.length}b ${_tun.sx},${_tun.sz} to dry rock${_tun.dryShaft ? ' (dry shaft)' : ''}, heading ${sx},${sz}`);
                        continue;
                    }
                }
            }
            break;
        }
        // No solid support under the new feet (cliff/cave) => don't blind-drop; stop.
        // ★T-0158①: a gravity block hanging over a void is NOT support — digging the cell above it drops it
        // (death #7: gravel floor over a cave, 17-block fall y49→32). Treat it exactly like no support.
        const _below = [3, 4, 5, 6].map(d => nm(bn(fx, cy - d, fz)));
        const _supportCollapses = supportCollapses(nm(support), _below);
        if (_supportCollapses) log_(`support ${nm(support)}@${fx},${cy - 2},${fz} hangs over ${_below.join('/')} — collapses when dug above; treating as void (T-0158)`);
        // ★T-0139 reopened: cave under the next step — step down when the floor is ≤3 below, else place the support
        //   (挖三填一) and descend as usual. Only if that can't be done fall through to void hop / relocate / abort.
        let _voidHandled = false;
        if (!_supportCollapses && voidBridges < 48) {
            const _vb = planVoidBridge(bn, cx, cy, cz, sx, sz);
            if (_vb && _vb.kind === 'drop') {
                _voidHandled = true; voidBridges++;
                if (voidBridges <= 3 || voidBridges % 8 === 0) log_(`void under ${fx},${cy - 2},${fz}: cave floor ${_vb.depth}b down — stepping down into it (T-0139)`);
            } else if (_vb && _vb.kind === 'bridge') {
                const _blk = bridgeBlockName();
                if (_blk && invCount(new RegExp(`^${_blk}$`)) >= _vb.place.length) {
                    let _ok = true;
                    for (const p of _vb.place) {
                        let r = false;
                        try { r = await skills.placeBlock(bot, _blk, p.x, p.y, p.z, p.on, true, { positioning: false }); } catch (e) { r = false; }
                        if (!r && !(bn(p.x, p.y, p.z) && bn(p.x, p.y, p.z).boundingBox === 'block')) { _ok = false; break; }
                    }
                    const _sup = bn(fx, cy - 2, fz);
                    if (_ok && _sup && _sup.boundingBox === 'block') {
                        _voidHandled = true; voidBridges++;
                        if (voidBridges <= 3 || voidBridges % 8 === 0) log_(`void under ${fx},${cy - 2},${fz}: placed ${_vb.place.length} ${_blk} as stair support (#${voidBridges}, T-0139)`);
                    } else log_(`void bridge at ${fx},${cy - 2},${fz} failed (placed=${_ok}) — falling back to void hop`);
                } else log_(`void under ${fx},${cy - 2},${fz}: no filler block to bridge (need ${_vb.place.length})`);
            }
        }
        if (!_voidHandled && (_supportCollapses || /^(air|cave_air|void_air|water|flowing_water)$/.test(nm(support)))) {
            rememberAbortedHeading(bot, sx, sz);   // ★T-0139 next dispatch turns away from the void
            // ★T-0137② turn / sidestep ≤4b to a column with 3 solid below and restart the stair — this dispatch
            if (voidHops < 3) {
                const near = (bot._mineDownFluidAvoid || []).filter(a => Date.now() - a.at < ABORT_HEADING_TTL_MS && Math.hypot(a.x - cur.x, a.z - cur.z) < 8);
                const plan = planVoidHop(bn, cx, cy, cz, sx, sz, near);
                if (plan && (plan.kind === 'turn' || await walkVoidHop(plan.path))) {
                    voidHops++;
                    log_(`void hop ${voidHops}/3: ${plan.kind === 'turn' ? 'turned' : `moved ${plan.path.length}b to ${plan.x},${plan.z}`} → heading ${plan.sx},${plan.sz} (cave under ${fx},${cy - 2},${fz})`);
                    sx = plan.sx; sz = plan.sz; noProg = 0;
                    continue;
                }
                log_(`void hop ${plan ? 'walk failed' : 'no safe column within 4b'} — abort`);
            }
            // ★T-0183 (live 22:58 @-8,69,-7: cave right under the surface, every heading void, 3 zero-dig dispatches →
            //   GO_UNDERGROUND cooled). Like the fluid branch: relocate once — side tunnel (T-0161), else under open sky
            //   walk away by pathfinder (works on the surface; it is underground where it never moved) — then restart.
            if (loopRelocates < 1) {
                loopRelocates++;
                let _moved = false;
                const _tun = planRelocateTunnel(bn, cx, cy, cz);
                if (_tun && await walkDugPath(bot, skills, Vec3, bn, _tun.path)) {
                    _moved = true;
                    log_(`void: no safe column within 4b — tunnelled ${_tun.path.length}b ${_tun.sx},${_tun.sz}`);
                } else {
                    // ★T-0193 (live 01:23:45 'void: no tunnel line and not under open sky' → abort): surface or underground,
                    //   walk to a reachable solid column (≤3 candidates, bounded); surface-only moveAway as last resort.
                    _moved = await relocateFallback(bot, skills, bn, log_, `void, no tunnel line${_tun ? ' (walk stopped: ' + (bot._walkDugFail || '?') + ')' : ''}`);
                }
                if (_moved) {
                    const _r2 = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, sx, sz);
                    sx = _r2.sx; sz = _r2.sz;
                    voidHops = 0; noProg = 0;
                    continue;
                }
            }
            abort = `no floor support under ${fx},${cy - 2},${fz} (${nm(support)}) — stop, don't free-fall`; break;
        }

        if (i < 3) log_(`DIAG step${i} cur=${cur.x.toFixed(2)},${cur.y.toFixed(2)},${cur.z.toFixed(2)} cx,cy,cz=${cx},${cy},${cz} fwd=${fx},${fz} sx,sz=${sx},${sz} blocks: newFeet(${fx},${cy - 1},${fz})=${nm(newFeet)} newHead(${fx},${cy},${fz})=${nm(newHead)} clear(${fx},${cy + 1},${fz})=${nm(clear)} support(${fx},${cy - 2},${fz})=${nm(support)}`);
        try {
            const r1 = await skills.breakBlockAt(bot, fx, cy + 1, fz);   // headroom (old head level)
            const r2 = await skills.breakBlockAt(bot, fx, cy, fz);       // new head
            const r3 = await skills.breakBlockAt(bot, fx, cy - 1, fz);   // new feet (one down-forward)
            if (i < 3) log_(`DIAG step${i} breakResults head+1=${r1} head=${r2} feet=${r3}`);
            // ★return-contract audit 2026-07-02: was `dug += 3` UNCONDITIONALLY — a re-dispatched
            // wedged bot no-op'ing on already-air cells returned {dug:6} "progress" with zero world
            // change (the -22,82,10 pin family). breakBlockAt returns strict true only when a block
            // was actually removed, so count only those.
            dug += [r1, r2, r3].filter(v => v === true).length;
        } catch (e) { abort = `dig threw: ${e && e.message || e}${/aborted/i.test(String(e && e.message || e)) ? ' ' + digInterrupter(bot) : ''}`; break; }   // ★T-0148 diag: who stopped our dig

        // ★T-0158②: never step into a column that is still collapsing (gravel/sand above or refilled cells).
        // Human: stand back, let it fall, dig what lands, repeat until it stops — THEN step in. Bounded; if the
        // column won't drain (tall gravel pile) give up this heading instead of walking under it.
        if (gravityPendingAbove(bn, fx, cy - 1, fz)) {
            let drained = false;
            for (let k = 0; k < 8 && !bot.interrupt_code && bot.health > 0; k++) {
                await new Promise(r => setTimeout(r, 400));   // let what's falling land
                for (const yy of [cy + 1, cy, cy - 1]) {
                    if (MD_GRAV_RE.test(nm(bn(fx, yy, fz)))) { try { if (await skills.breakBlockAt(bot, fx, yy, fz) === true) dug++; } catch (e) {} }
                }
                if (!gravityPendingAbove(bn, fx, cy - 1, fz)) { drained = true; break; }
            }
            if (!drained) {
                rememberAbortedHeading(bot, sx, sz);
                abort = `gravity column over ${fx},${cy - 1},${fz} won't settle — not stepping under it (T-0158)`;
                break;
            }
            log_(`gravity column at ${fx},${cy - 1},${fz} drained — stepping in (T-0158)`);
        }

        // ★T-0180 ① (shared primitive, death #11 shape): the step just dug toward a natural cavity with a hostile
        //   around (stair descends → band starts one below the feet) → plug it, remember the heading, stop here.
        if (typeof skills.sealCavityBreach === 'function') {
            try {
                const br = await skills.sealCavityBreach(bot, sx, sz, { yLo: -1, tag: 'mineDown' });
                if (br.breached) {
                    rememberAbortedHeading(bot, sx, sz);
                    // ★T-0203 (live 01:18:47-56: one heading per dispatch → 3 dug=1 failures → GO_UNDERGROUND cooled): keep
                    //   the seal / not-entering, but try another heading in THIS dispatch; all four breach → relocate once.
                    const _rc = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, sx, sz);
                    if (_rc.rotated && cavityTurns < 3) {
                        cavityTurns++;
                        log_(`cavity turn ${cavityTurns}/3: heading ${sx},${sz} → ${_rc.sx},${_rc.sz} (breach sealed ${br.sealed}, T-0180)`);
                        sx = _rc.sx; sz = _rc.sz; noProg = 0;
                        continue;
                    }
                    if (_rc.exhausted && loopRelocates < 1) {
                        loopRelocates++;
                        if (await relocateFallback(bot, skills, bn, log_, 'every heading breaches a cavity with a hostile near')) {
                            const _r2 = rotateAwayFromAborted(bot._mineDownFluidAvoid, bot.entity.position, sx, sz);
                            sx = _r2.sx; sz = _r2.sz; noProg = 0;
                            continue;
                        }
                    }
                    abort = `cavity breach + hostile ≤16b toward ${sx},${sz} — sealed ${br.sealed}, not entering (T-0180)`;
                    break;
                }
            } catch (e) {}
        }

        // Walk forward; the bot falls 1 block into the cleared step. Low-level (no pathfinder).
        const _gateBeforeWalk = reflexGateRefusals(bot);   // ★T-0267
        try {
            await bot.lookAt(new Vec3(fx + 0.5, cy - 0.5, fz + 0.5), true);
            bot.setControlState('forward', true);
            const t0 = Date.now();
            while (Date.now() - t0 < 2500) { const p = bot.entity.position; if (Math.hypot(p.x - (fx + 0.5), p.z - (fz + 0.5)) < 0.4) break; await new Promise(r => setTimeout(r, 100)); }
        } finally { try { bot.setControlState('forward', false); } catch (e) {} }

        const np = bot.entity.position;
        const stepDescended = (cur.y - np.y) > 0.5;
        const stepMovedHoriz = Math.hypot(np.x - cur.x, np.z - cur.z) > 0.5;
        if (stepDescended || stepMovedHoriz) {
            try {
                const swept = await collectExposedOresDuringDescent(bot, ctx);
                if (swept.mined > 0) {
                    ore += swept.mined;
                    log_(`顺手采矿 ${swept.family} x${swept.mined} (${swept.elapsedMs}ms)`);
                }
            } catch (e) { log_(`顺手采矿跳过: ${e && e.message || e}`); }
        }
        if (i < 3) log_(`DIAG step${i} afterWalk pos=${np.x.toFixed(2)},${np.y.toFixed(2)},${np.z.toFixed(2)} (moved dx=${(np.x - cur.x).toFixed(2)} dy=${(np.y - cur.y).toFixed(2)} dz=${(np.z - cur.z).toFixed(2)})`);
        if (i % 5 === 0) log_(`step ${i + 1} pos=${Math.round(np.x)},${Math.round(np.y)},${Math.round(np.z)} dug=${dug} ore=${ore} hp=${Math.round(bot.health)} food=${bot.food}`);
        // ★FIX no-advance guard: the OLD test compared np.x to the cell INDEX with a <0.3 band,
        // which a stable .30 fractional offset slips through forever (live: 40 steps, 0 descent,
        // guard never fired). Judge ACTUAL per-step progress instead: a real step drops y by ~1
        // OR moves >0.5 horizontally. Neither = wedged this step. Abort after 2 wedged steps so a
        // genuinely-stuck mineDown returns an honest "no descent" fast (→ higher layer can relocate)
        // instead of grinding 120 no-op digs in place.
        const _so = stepOutcome({ descended: stepDescended, movedHoriz: stepMovedHoriz, gateBlocked: reflexGateRefusals(bot) > _gateBeforeWalk, reflexWaits });
        if (_so === 'reflex') {
            reflexWaits++;
            if (reflexWaits <= 2 || reflexWaits % 4 === 0) log_(`step held by a reflex (${(bot._bodyOwner && bot._bodyOwner.name) || '?'}) — not a wedge, waiting for it to let go (${reflexWaits}/${REFLEX_STEP_WAITS_MAX}, T-0267)`);
            const _tw = Date.now();
            while (reflexHolds(bot) && Date.now() - _tw < 4000 && !bot.interrupt_code && bot.health > 0) await new Promise(r => setTimeout(r, 200));
            continue;
        }
        if (_so === 'wedge') noProg++; else noProg = 0;
        if (noProg >= 2) {
            // ★P2-8: 楔死不再立刻放弃 — 先走幽灵格恢复链 (re-dig/blacklist/sidestep 换向), 只有
            // 恢复链也无路 (同点 x3 / 侧移预算尽 / 两向全堵) 才诚实 fail 进冷却.
            const handled = await wedgeRecover(fx, cy, fz);
            if (handled === 'retry') { noProg = 0; continue; }
            if (handled === 'wedge-final') wedgeFinal = true;
            abort = `no descent — wedged ${noProg} steps at ${Math.round(np.x)},${Math.round(np.y)},${Math.round(np.z)} (${handled}); yield`;
            break;
        }
    }

    let inv = {}; try { for (const it of bot.inventory.items()) inv[it.name] = (inv[it.name] || 0) + it.count; } catch (e) {}
    const r = { endY: Math.round(bot.entity.position.y), dug, oreVeins: ore, hp: Math.round(bot.health), food: bot.food, abort, raw_iron: inv.raw_iron || 0, iron_ore: 0, wedgeRecoveries, wedgeFinal };
    if (deferredByShooter) r.deferred = true;   // ★T-0225 kernel: deferred ≠ failure
    // ★KERNEL-CONTRACT FIX (return-contract audit 2026-07-02): this is the file's ONLY return and
    // it was always truthy with no failed key, so every ZERO-PROGRESS exit reset the kernel's
    // dispatch-failure counter (kernel.js failed-sniff = threw / ===false / ok===false /
    // failed===true) and the committed kind re-dispatched the identical abort every ~2s forever:
    // step-0 aborts (fluid near stair cell / no floor support / pick-runway) against static world
    // blocks on a deterministic +x heading, at-depth mined-out-seam exits, and wedged air-no-op
    // re-digs. GO_UNDERGROUND stays committed until iron pick/buffer, DUSK_MINE_NIGHT ALL NIGHT —
    // unbreakable hot livelock, the 3-strike/5-min cooldown could never trip. Judge REAL progress
    // this dispatch against the entry snapshot (descended >=1 block OR net ore units gained);
    // zero progress marks failed:true so the cooldown engages and the commitment is released.
    // Shape keeps all fields (kernel is the only consumer; no other caller reads this object).
    // ★P2-8: wedge-final 走过 moveAway 8b — 顺坡白得的 y 差不是"下降进度", 抬高下降门槛到 >=3
    // (moveAway 顺坡至多白得 1-2 格; 真挖降 3+ 格再楔死的派发不该被一票否决白吃 strike),
    // 否则 moveAway 下坡 1 格就把三连楔死洗成 truthy = 新活锁口.
    const progressed = dispatchProgressed({ wedgeFinal, entryY, endY: r.endY, oreGain: oreUnits() - oreUnitsAtEntry, cobbleGain: cobbleUnits() - cobbleAtEntry });
    if (!progressed && !r.deferred) r.failed = true;
    log_(`DONE ${JSON.stringify(r)}`);
    return r;
}

export { stairCells, stairSafety };
