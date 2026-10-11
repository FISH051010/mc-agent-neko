// Hot-reloadable REAL skill: the missing GET_ARMOR@68 dispatch target — turn banked
// iron (raw_iron + iron_ingot) into WORN iron armor, cheapest piece first, NO cheats.
// Closes the chronic unarmored-death gap: smelt what's needed via smeltSafe (safe
// furnace placement), craft each piece via craftChain's array-preset form (safe table
// placement under canopy), then armorManager.equipAll (mineDiamonds idiom).
//
// Return contract (kernel dispatch-cooldown discipline):
//   - number of armor pieces now held+worn (>0, truthy) ONLY when THIS dispatch made
//     progress: crafted a piece, newly equipped one (worn-slot delta), or the full
//     4-piece set is now held/worn (safe: isGoalDone armor>=4 releases GET_ARMOR).
//     Count semantics match modes.js vitals.armor (held + worn both count).
//   - false on EVERY zero-progress dispatch, even with 1-3 stale pieces held — the
//     kernel counts failure only on res===false, so returning a stale held count
//     resets its 3-strike/5-min cooldown and resurrects the exact GET_ARMOR
//     dispatch-spin livelock this file exists to close (isGoalDone alone can't
//     release: ironForArmor counts raw_iron+ingot and can sit >=4 forever).
// Red lines honored: interrupt+death checked EVERY pass; no module-level state (loop
// locals only); no infinite retry (stall>=2 on the same piece → stop).
// Invoked via: {"skill":"craftArmor"}  ctx = { skills, world, mc, Vec3, log }
// ★T-0151 防护优先序 (胸 > 腿 > 盔 > 靴), 与 framework/armor_gate.PROTECTION_ORDER 同序。
// ★T-0229 盾第一 (监工拍板: 三次骷髅死, arrow_guard 只差一面盾): 盾 > 胸 > 腿 > (铁剑) > 盔 > 靴; 盾 1 锭 + 6 木板, 不吃铁镐预留额, 造好即上副手。
import fs from 'fs';
import path from 'path';
const progLine = (s) => { try { fs.appendFileSync(path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt'), `[${new Date().toISOString()}] ${s}\n`); } catch (e) {} };
export const PROTECTION_PIECES = (tier) => tier === 'diamond'
    ? [['diamond_chestplate', 8], ['diamond_leggings', 7], ['diamond_helmet', 5], ['diamond_boots', 4]]
    : [['shield', 1], ['iron_chestplate', 8], ['iron_leggings', 7], ['iron_helmet', 5], ['iron_boots', 4]];
export const PROTECTION_PIECES_WITH_SWORD = [['shield', 1], ['iron_chestplate', 8], ['iron_leggings', 7], ['iron_sword', 2], ['iron_helmet', 5], ['iron_boots', 4]];
const SHIELD_PLANKS = 6;
export default async function craftArmor(bot, ctx, opts = {}) {
    const { skills, world, log } = ctx;
    const maxMs = (opts && opts.maxMs) || 180000;
    const TIER = (opts && opts.tier) === 'diamond' ? 'diamond' : 'iron';   // ★2026-07-06 钻甲档 ([[spec-pickaxe-stockpile-redesign]])
    const t0 = Date.now();
    const inv = () => world.getInventoryCounts(bot);

    // [name, cost] CHEAPEST-FIRST so scarce material becomes some protection asap. 钻甲用钻石数 (同 4/5/7/8)。
    const PIECES = TIER === 'diamond'
        ? [['diamond_boots', 4], ['diamond_helmet', 5], ['diamond_leggings', 7], ['diamond_chestplate', 8]]
        : [['shield', 1], ['iron_boots', 4], ['iron_helmet', 5], ['iron_leggings', 7], ['iron_chestplate', 8]];   // ★T-0229 盾先
    const ARMOR_RE = /_helmet$|_chestplate$|_leggings$|_boots$/;
    // 完成判据用"本档"甲件 (钻甲: 4 件钻甲; 铁甲: 沿用全甲件 — 铁阶段只有铁甲)。
    const TIER_RE = TIER === 'diamond' ? /^diamond_(helmet|chestplate|leggings|boots)$/ : ARMOR_RE;

    // Pieces the bot HAS. getInventoryCounts iterates ALL slots (armor 5-8 included),
    // so held AND worn both count — same semantics as modes.js vitals.armor.
    const piecesHave = () => {
        let n = 0;
        try { const c = inv(); for (const k of Object.keys(c)) if (TIER_RE.test(k)) n += c[k]; } catch (e) {}
        return n;
    };
    const havePiece = (name) => {
        if ((inv()[name] || 0) > 0) return true; // covers worn too, but be explicit below anyway
        try {
            const sl = bot.inventory.slots || [];
            for (let i = 5; i <= 8; i++) if (sl[i] && sl[i].name === name) return true;
        } catch (e) {}
        return false;
    };
    // Pieces actually WORN (armor slots 5-8 only). Equipping moves held→worn without
    // changing piecesHave(), so the worn delta is how we detect "newly equipped" progress.
    const wornCount = () => {
        let n = 0;
        try {
            const sl = bot.inventory.slots || [];
            for (let i = 5; i <= 8; i++) if (sl[i] && ARMOR_RE.test(sl[i].name || '')) n++;
        } catch (e) {}
        return n;
    };
    const wornAtEntry = wornCount();

    // ★2026-07-05 铁镐保留额 (实弹事故: 首批 3 锭+1 raw 被 boots(4铁)截胡 — 铁镐目标只因
    // 缺 2 根棍被跳过, 铁流进甲件, 钻石解锁被推迟一整个补给周期)。无铁镐(含更高阶)时,
    // 永久保留 3 铁给镐: 甲件预算 = 总铁 - 3。keepInventory 下裸奔多死几次是可接受消耗,
    // 晚拿钻石不是。有镐后此门自动失效, 甲件照常。
    const _hasIronPick = () => {
        try { return bot.inventory.items().some(i => /^(iron|diamond|netherite)_pickaxe$/.test(i.name)); } catch (e) { return false; }
    };
    const _diaPicksN = () => { try { return bot.inventory.items().filter(i => /^(diamond|netherite)_pickaxe$/.test(i.name)).reduce((s, i) => s + i.count, 0); } catch (e) { return 0; } };   // ★review: 含 netherite(与 pickStockPlan 同口径, 免幽灵保留)
    // 材料预算 = 手头材料 - 保留额。铁: 无镐时留 3 铁给镐。钻: 未囤够 3 钻镐前留 9 钻给镐 (用户令 先囤3钻镐再钻甲)。
    const _matTotal = () => TIER === 'diamond' ? (inv()['diamond'] || 0) : ((inv()['iron_ingot'] || 0) + (inv()['raw_iron'] || 0));
    const _matReserve = () => TIER === 'diamond' ? (_diaPicksN() >= 3 ? 0 : 9) : (_hasIronPick() ? 0 : 3);
    const _matBudget = () => _matTotal() - _matReserve();

    let crafted = 0, stall = 0;
    for (let pass = 0; pass < 4; pass++) {
        if (bot.interrupt_code || bot.health <= 0 || Date.now() - t0 > maxMs) break;

        // ★T-0151 先甲后钻 (监工拍板): order='protection' → 胸>腿>盔>靴, 挑造得起的最高防护件 (能造几件造几件);
        //   都造不起 → 停 (诚实零进度)。默认仍是 cheapest-first (稀缺料先换到"有"甲)。
        // ★T-0170 (监工): 已有铁镐时防护序 胸 > 腿 > 铁剑 > 盔 > 靴 (与 armor_gate.PROTECTION_ORDER_WITH_SWORD 同序)
        const _goodSword = () => { try { return bot.inventory.items().some(i => /^(iron|diamond|netherite)_sword$/.test(i.name)); } catch (e) { return false; } };
        const _order = (TIER === 'iron' && _hasIronPick()) ? PROTECTION_PIECES_WITH_SWORD : PROTECTION_PIECES(TIER);
        const target = (opts && opts.order === 'protection')
            ? (_order.find(([n, c]) => (n === 'iron_sword' ? !_goodSword() : !havePiece(n)) && c <= (n === 'shield' ? _matTotal() : _matBudget())) || null)
            : PIECES.find(([n]) => !havePiece(n));
        if (!target) break; // full set held/worn (or nothing affordable in protection order) — done
        const [piece, cost] = target;

        // ★材料保留额执行点: 这件甲会吃掉镐的保留材料 → 停 (钻甲留 9 钻给 3 钻镐; 铁甲留 3 铁给镐)。
        if (cost > (piece === 'shield' ? _matTotal() : _matBudget())) {   // ★T-0229 盾不吃铁镐预留额
            log(bot, `craftArmor[${TIER}]: RESERVE gate — ${piece} costs ${cost} but budget is ${_matBudget()} `
                + `(mat ${_matTotal()}, reserve ${_matReserve()}) — stopping, material goes to the pickaxe first.`);
            break;
        }

        // 铁甲: 冶炼够本件的铁 (钻甲无需冶炼, 钻石即成品材料; 缺料由 _matBudget 门在上面挡住)。
        if (TIER === 'iron') {
            const ingots = inv()['iron_ingot'] || 0;
            if (ingots < cost) {
                const need = cost - ingots;
                const raw = inv()['raw_iron'] || 0;
                if (raw > 0) {
                    await skills.customSkill(bot, 'smeltSafe', 'raw_iron', Math.min(raw, need)).catch(() => {});
                } else {
                    // Can't afford the next piece — stop. Zero-craft dispatch → false below → kernel 3-strike cooldown.
                    log(bot, `craftArmor: iron short for ${piece} (${ingots}/${cost} ingots, no raw_iron) — stopping; `
                        + (crafted > 0 ? `crafted ${crafted} this dispatch, returning progress.`
                                       : `zero crafts this dispatch → false unless equip below newly wears a piece (kernel cooldown).`));
                    break;
                }
            }
        }

        // Craft via craftChain's array-preset form (handles table placement under canopy).
        const before = inv()[piece] || 0;
        const recipe = [[piece, 1]];
        if (piece === 'shield') {   // craftChain 只合成清单里列出的木板 → 先补够 6 木板
            const c = inv();
            const planks = Object.keys(c).filter(k => /_planks$/.test(k)).reduce((t, k) => t + (c[k] || 0), 0);
            const log = Object.keys(c).filter(k => /_(log|stem)$/.test(k) && c[k] > 0).sort((a, b) => c[b] - c[a])[0];
            if (planks < SHIELD_PLANKS && log) recipe.unshift([log.replace(/_(log|stem)$/, '_planks'), Math.ceil((SHIELD_PLANKS - planks) / 4)]);
        }
        await skills.customSkill(bot, 'craftChain', recipe).catch(() => {});
        const after = inv()[piece] || 0;
        if (piece === 'shield' && after > before) {   // 造好即上副手 — arrow_guard 认 slot 45, 别等第一支箭才去换
            await skills.equip(bot, 'shield').catch(() => {});
            const _m = `craftArmor: shield crafted → off-hand (slot45=${(bot.inventory.slots[45] && bot.inventory.slots[45].name) || 'none'})`;
            log(bot, _m); progLine(_m);
        }

        // NO-PROGRESS cutoff: never infinite-retry the same failing craft (red line).
        if (after > before) { crafted++; stall = 0; }
        else if (++stall >= 2) {
            log(bot, `craftArmor: no progress on ${piece} twice (smelt/craft failing) — stop, no infinite retry.`);
            break;
        }
    }

    // ★T-0229 (监工验收): 背包里有盾但副手不是盾 (旧版造的 / 被换下) → 补装副手, 并把 slot45 实况写进 progress
    try {
        const off = bot.inventory.slots[45];
        if (!(off && off.name === 'shield') && bot.inventory.items().some(i => i.name === 'shield')) {
            await skills.equip(bot, 'shield').catch(() => {});
            progLine(`craftArmor: shield in pack → equip off-hand (slot45=${(bot.inventory.slots[45] && bot.inventory.slots[45].name) || 'none'})`);
        }
    } catch (e) {}

    // Equip whatever we now have (armorManager idiom from mineDiamonds:26; name-based
    // skills.equip fallback when the plugin is absent).
    if (bot.armorManager) {
        try { await bot.armorManager.equipAll(); } catch (e) {}
    } else {
        for (const it of bot.inventory.items()) {
            if (bot.interrupt_code) break;
            if (ARMOR_RE.test(it.name || '')) await skills.equip(bot, it.name).catch(() => {});
        }
    }

    const have = piecesHave();
    const newlyWorn = wornCount() - wornAtEntry;
    // Progress = crafted a piece, newly wore one, or the full set is complete (full set
    // is safe to return truthy: isGoalDone GET_ARMOR armor>=4 releases the commitment).
    // A STALE held count is NOT progress — returning it truthy resets the kernel's
    // _dispatchFails counter (only res===false counts as failure) and the 3-strike/5-min
    // cooldown never engages, hot-spinning GET_ARMOR above the whole tier chain.
    const progressed = crafted > 0 || newlyWorn > 0 || have >= 4;
    log(bot, `craftArmor[${TIER}] done: crafted ${crafted}, newly worn ${newlyWorn > 0 ? newlyWorn : 0}, ${TIER} armor held+worn=${have}/4, `
        + (TIER === 'diamond' ? `diamond=${inv()['diamond'] || 0} diaPicks=${_diaPicksN()} ` : `iron_ingot=${inv()['iron_ingot'] || 0} raw_iron=${inv()['raw_iron'] || 0} `) + `hp=${Math.round(bot.health || 0)}`
        + (progressed ? '' : ' — NO progress this dispatch → false (kernel 3-strike cooldown).'));
    return progressed ? (have || crafted || newlyWorn || true) : false;   // ★T-0229 只造了盾时 have=0 也要真值
}
