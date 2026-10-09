// Hot-reloadable REAL skill: reliably smelt by placing the furnace ourselves
// first (clearing any leaf/grass in the way), then calling smeltItem. The stock
// smeltItem's auto furnace placement fails under jungle canopy / uneven ground
// (blockUpdate timeout), same issue craftChain had with the crafting table.
// Invoked via: !newAction("await skills.customSkill(bot, 'smeltSafe', 'raw_iron', 6)")
// ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
const STATIONS_F = path.resolve(process.cwd(), 'bots', '_supervisor', 'stations.json');
// 状态池登记 (满地台炉根治的一环): 任何用到/放置的熔炉都进 stations.json
const stRegister = (type, p) => {
    try {
        let a = []; try { a = JSON.parse(fs.readFileSync(STATIONS_F, 'utf8')); if (!Array.isArray(a)) a = []; } catch (e) {}
        a = a.filter(s => !(s.type === type && Math.abs(s.x - p.x) < 2 && Math.abs(s.y - p.y) < 2 && Math.abs(s.z - p.z) < 2));
        a.push({ type, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), t: Date.now() });
        fs.writeFileSync(STATIONS_F, JSON.stringify(a));
    } catch (e) {}
};
// ★T-0138 (18:57:06Z 实录: GET_IRON_TOOLS→smeltSafe ×3、GET_ARMOR→craftArmor→smeltSafe ×3 全部秒败冷却; 背包
//   圆石 144 + 原木 12 + 0 台 0 炉): 熔炉是 3×3 配方, craftRecipeLocal 只认"随身台/4 格内台" — 没台就退出, 可木料
//   就在包里。人类: 先拍一张台再做炉。自给自足: 缺台且木料够 → 先折板造随身台。日志同落 progress.txt。
const PROG_SS = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const progSS = (m) => { try { fs.appendFileSync(PROG_SS, `[${new Date().toISOString()}] [smeltSafe] ${m}\n`); } catch (e) {} };
export async function ensureCarriedTable(bot, { skills, world }) {
    const c = () => world.getInventoryCounts(bot) || {};
    if ((c()['crafting_table'] || 0) > 0) return true;
    try { if (world.getNearestBlock(bot, 'crafting_table', 4)) return true; } catch (e) {}
    const planks = () => Object.keys(c()).filter(k => k.endsWith('_planks')).reduce((s, k) => s + (c()[k] || 0), 0);
    if (planks() < 4) {
        const log = Object.keys(c()).find(k => k.endsWith('_log') && c()[k] > 0);
        if (log) await skills.craftRecipeLocal(bot, log.replace(/_log$/, '_planks'), 1).catch(() => false);
    }
    if (planks() >= 4) await skills.craftRecipeLocal(bot, 'crafting_table', 1).catch(() => false);
    return (c()['crafting_table'] || 0) > 0;
}
// ★T-0164 (20:40:57Z 实录: smeltSafe(raw_iron x8) consumed=8, 背包 0 铁锭 → craftArmor 后续必败, 8 铁滞留炉中):
//   旧进度 = 输入差, 可 smeltItem 窗口丢/炉没了 → stale 放弃时输入还在炉里, "料进了炉"被记成冶炼成功。
//   ① 进度按【产物】增量记 (已知配方); ② 进了炉没出来的记成滞留 (落盘, 重启不丢), 下次 smeltSafe 先回炉收回。
export const SMELT_PRODUCT = {
    raw_iron: 'iron_ingot', iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot',
    raw_gold: 'gold_ingot', gold_ore: 'gold_ingot', raw_copper: 'copper_ingot',
    beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton',
    rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato',
    sand: 'glass', cobblestone: 'stone', kelp: 'dried_kelp',
};
/** 纯函数: 本次派发的冶炼账。product 未知 → produced=null, 退回旧口径 (consumed>0)。 */
export function smeltLedger(item, before, after) {
    const product = SMELT_PRODUCT[item] || null;
    const consumed = (before[item] || 0) - (after[item] || 0);
    const produced = product ? (after[product] || 0) - (before[product] || 0) : null;
    const progressed = product ? produced > 0 : consumed > 0;
    const stranded = product ? Math.max(0, consumed - Math.max(0, produced)) : 0;
    return { product, consumed, produced, progressed, stranded };
}
const STRANDED_F = path.resolve(process.cwd(), 'bots', '_supervisor', 'stranded_smelt.json');
const STRANDED_MAX_AGE_MS = 3 * 3600 * 1000;
const STRANDED_REACH = 64;
export function readStranded() {
    try { const s = JSON.parse(fs.readFileSync(STRANDED_F, 'utf8').replace(/^﻿/, '')); return s && Number.isFinite(s.x) ? s : null; } catch (e) { return null; }
}
export function writeStranded(rec) {
    try { if (rec) fs.writeFileSync(STRANDED_F, JSON.stringify(rec)); else fs.rmSync(STRANDED_F, { force: true }); } catch (e) {}
}
/** 就在炉边: 清炉 (锭+残料+燃料回包) 再把炉挖回背包 (随身炉, 同 replenishKit ⑨离场收台)。返回 {got, furnace}。 */
export async function clearAndPickUp(bot, { skills, world }, item, product) {
    const before = { ...(world.getInventoryCounts(bot) || {}) };
    try { await skills.clearNearestFurnace(bot); } catch (e) {}
    const mid = world.getInventoryCounts(bot) || {};
    const got = ((mid[product] || 0) - (before[product] || 0)) + ((mid[item] || 0) - (before[item] || 0));
    let furnace = false;
    if (!bot.interrupt_code) {
        const f0 = before['furnace'] || 0;
        try { await skills.collectBlock(bot, 'furnace', 1); } catch (e) {}
        furnace = ((world.getInventoryCounts(bot) || {})['furnace'] || 0) > f0;
    }
    return { got, furnace };
}
/** 回滞留炉收产物/残料并收炉。true = 收回了东西。炉已不在/过期 → 清记录; 太远 → 保留记录, 不阻塞本次冶炼。 */
export async function reclaimStranded(bot, { skills, world, log }) {
    const rec = readStranded();
    if (!rec) return false;
    if (Date.now() - (rec.at || 0) > STRANDED_MAX_AGE_MS) { writeStranded(null); return false; }
    const p = bot.entity && bot.entity.position;
    if (!p) return false;
    const d = Math.hypot(p.x - rec.x, p.y - rec.y, p.z - rec.z);
    if (d > STRANDED_REACH) { log(bot, `stranded furnace @${rec.x},${rec.y},${rec.z} (${rec.n} ${rec.item}) ${Math.round(d)}b away — too far, keep record`); return false; }
    const before = world.getInventoryCounts(bot) || {};
    try { if (d > 3) await skills.goToPosition(bot, rec.x, rec.y, rec.z, 2); } catch (e) {}
    if (bot.interrupt_code) return false;
    let fb = null;
    try { fb = bot.blockAt(p.offset(rec.x - p.x, rec.y - p.y, rec.z - p.z)); } catch (e) {}
    if (fb && !/furnace/.test(fb.name || '')) { log(bot, `stranded furnace @${rec.x},${rec.y},${rec.z} is gone (${fb.name}) — dropping record`); writeStranded(null); return false; }
    const { got, furnace } = await clearAndPickUp(bot, { skills, world }, rec.item, rec.product);
    log(bot, `reclaim stranded furnace @${rec.x},${rec.y},${rec.z}: +${got} (${rec.product}/${rec.item}, expected ${rec.n})${furnace ? ' + furnace picked up' : ''}`);
    if (got > 0 || furnace) writeStranded(null);
    return got > 0;
}
export default async function smeltSafe(bot, ctx, item, num = 1) {
    const { skills, world } = ctx;
    const log = (b, m) => { ctx.log(b, m); progSS(m); };
    // ★T-0164: 上次滞留在炉里的料/锭先收回 (收回的锭可能直接满足本次需求)
    if (await reclaimStranded(bot, { skills, world, log }).catch(() => false)) {
        const prod = SMELT_PRODUCT[item];
        if (prod && (world.getInventoryCounts(bot)[prod] || 0) >= num) { log(bot, `reclaimed ${prod} covers this request (${num}) — done`); return true; }
    }
    const findFurnace = () => world.getNearestBlock(bot, 'furnace', 4);
    let placedNow = false;
    if (!findFurnace()) {
        if (!(world.getInventoryCounts(bot)['furnace'] > 0)) {
            if (!(await ensureCarriedTable(bot, { skills, world }))) log(bot, 'smeltSafe: no carried/nearby table and no wood to make one');
            // Furnace is a 3x3 recipe. Craft it in the current pocket instead of
            // walking toward an old remote table; abort cleanly if no reachable
            // table can be placed. A failed craft must never fall through into
            // destructive placement recovery with an empty furnace inventory.
            const crafted = await skills.craftRecipeLocal(bot, 'furnace', 1).catch(() => false);
            if (!crafted || !(world.getInventoryCounts(bot)['furnace'] > 0)) {
                log(bot, 'smeltSafe: could not craft a furnace locally; placement skipped without moving or clearing terrain.');
                return false;
            }
        }
        // Smelting is a workstation action, not a travel request. Try one bounded
        // adjacent placement (at most a two-block niche), with no relocation or
        // pillar escape. Higher layers may explicitly choose a new work area.
        const placed = await skills.placeBlockNearby(bot, 'furnace', {
            maxTries: 1,
            relocate: false,
            pillar: false,
            positioning: false,
            maxDigBlocks: 2,
        }).catch(() => false);
        const observedFurnace = findFurnace();
        if (!observedFurnace) {
            log(bot, 'smeltSafe: could not place the carried furnace beside the bot; smelting aborted in place.');
            return false;
        }
        if (!placed) {
            log(bot, 'smeltSafe: placement confirmation failed, but the furnace is present; continuing with the observed furnace.');
        }
        log(bot, 'furnace placed');
        placedNow = true;
    }
    { const f0 = findFurnace(); if (f0) stRegister('furnace', f0.position); }   // 用到即登记
    // ★kernel return contract (return-contract audit 2026-07-02): smeltItem signals EVERY
    // zero-progress mode by RETURNING false, never throwing — no fuel / fuel stack too small /
    // foreign input parked in the furnace / not enough input / no furnace / 11s zero-collection
    // timeout (skills.js:487-618). The old unconditional `return true` fed all of those to the
    // kernel as success, resetting its 3-strike counter every ~2s dispatch while isGoalDone
    // (hasIronTierPick for both GET_IRON_TOOLS and NIGHT_SMELT_IRON) provably can't release
    // with zero ingots produced → unbreakable hot livelock. Progress = INPUT-COUNT DELTA over
    // THIS dispatch (snapshot taken here, AFTER furnace craft/placement, so e.g. cobblestone
    // spent crafting the furnace can't masquerade as smelt progress): smeltItem retrieves
    // leftover input before returning, so consumed == items actually smelted — which also
    // credits partial smelts (total < num) that smeltItem itself mislabels as false.
    const before = { ...(world.getInventoryCounts(bot) || {}) };
    const furnaceAt = (() => { const f = findFurnace(); return f && f.position ? { x: Math.floor(f.position.x), y: Math.floor(f.position.y), z: Math.floor(f.position.z) } : null; })();
    const ok = await skills.smeltItem(bot, item, num);
    let L = smeltLedger(item, before, world.getInventoryCounts(bot) || {});
    // ★T-0164 (监工②): 没被打断就在炉边收尾 — 有滞留先清炉 (锭+残料回包), 自己放的随身炉挖回背包。
    //   被打断不收尾 (不跟保命反射抢身体), 只落盘滞留记录, RECLAIM_FURNACE 差事/下次 smeltSafe 回炉收。
    if (!bot.interrupt_code && furnaceAt && (L.stranded > 0 || placedNow)) {
        const r = await clearAndPickUp(bot, { skills, world }, item, L.product || item);
        L = smeltLedger(item, before, world.getInventoryCounts(bot) || {});
        log(bot, `smeltSafe: wrap-up at furnace — cleared +${r.got}${r.furnace ? ', furnace picked up' : ''} (produced ${L.produced}, stranded ${L.stranded})`);
    }
    // ★T-0164: 仍有进了炉没出来的 (打断/窗口丢/炉 stale) → 落盘滞留记录, 下次回炉收
    if (L.stranded > 0 && furnaceAt) {
        writeStranded({ ...furnaceAt, item, product: L.product, n: L.stranded, at: Date.now() });
        log(bot, `smeltSafe: ${L.stranded} ${item} left in furnace @${furnaceAt.x},${furnaceAt.y},${furnaceAt.z} (produced ${L.produced}) — recorded for reclaim`);
    }
    // ★2026-07-14 (评审实锤): 被打断的派发不按库存差记进度 — 打断且炉窗已丢时 smeltItem 不强收
    //   炉内残料, "料进了炉"≠"炼出了锭", delta 会把它记成 consumed>0 → 假成功喂内核重置 3-strike。
    //   打断一律如实报 false (kernel 正确计一次失败; 料在炉里丢不了, 下次 smeltSafe 回炉收回)。
    if (bot.interrupt_code) {
        log(bot, `smeltSafe: dispatch interrupted — not crediting progress (ok=${ok}).`);
        return false;
    }
    log(bot, `smeltSafe(${item} x${num}) done. consumed=${L.consumed} produced=${L.produced} inv=${JSON.stringify(world.getInventoryCounts(bot))}`);
    if (ok !== true && !L.progressed) {   // smeltItem true = 锭已全数收到 (total>=num); 否则看产物增量
        log(bot, `smeltSafe: NO progress this dispatch (ok=${ok}, consumed=${L.consumed}, produced=${L.produced}) → false (kernel 3-strike cooldown).`);
        return false;
    }
    return true;
}
