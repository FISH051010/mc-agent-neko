// ★T-0151 先甲后钻 (监工拍板 10-10, 用户排序"镐 > 装备": 铁镐到手下一步就是装备; GET_ARMOR 只白天是时段闸不是优先级)。
// 证据: 19:52Z 第三局铁镐刚造好, bot 无甲夜里直接 mineDiamonds 下深层, 背包 11 粗铁闲置; keepInventory=false →
//   无甲下深层是最贵的赌注 (历史死亡 86% 无甲)。
// ① 防护优先序 (胸 > 腿 > 盔 > 靴): 能造几件造几件 (每件挑造得起的最高防护);
// ② keepInventory=false 时钻石下潜要求护甲点 ≥8 或已穿胸甲; keepInventory=true 不加门。
// ★T-0229 盾牌第一 (监工战略拍板 10-10: #13/#21/#22 三次骷髅死, bot 从没有盾; arrow_guard 早已装好 — 每拍弹道预测 + 副手举盾,
//   只差一面盾)。盾 = 1 铁锭 + 6 木板, 最便宜的一档防护 → 防护序首位; 不受"给铁镐留 3 铁"的预留额约束 (1 锭换挡箭, 收益高于晚 1 锭的镐)。
export const SHIELD_PIECE = ['shield', 1];
export const SHIELD_PLANKS = 6;
export const PROTECTION_ORDER = [SHIELD_PIECE, ['iron_chestplate', 8], ['iron_leggings', 7], ['iron_helmet', 5], ['iron_boots', 4]];
export const DIAMOND_ARMOR_MIN_POINTS = 8;
const POINTS = {
    leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
    golden: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
    chainmail: { helmet: 2, chestplate: 5, leggings: 4, boots: 1 },
    iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
    diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
    netherite: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
};
const pieceOf = (name) => { const m = /^(leather|golden|chainmail|iron|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.exec(name || ''); return m ? { mat: m[1], slot: m[2] } : null; };

/** 身上穿着的甲名 (mineflayer 装备槽 5-8)。 */
export function equippedArmorNames(bot) {
    try { return [5, 6, 7, 8].map(i => bot.inventory.slots[i]).filter(Boolean).map(it => it.name); } catch (e) { return []; }
}
export function armorPoints(names) {
    let p = 0;
    for (const n of names || []) { const x = pieceOf(n); if (x) p += POINTS[x.mat][x.slot] || 0; }
    return p;
}
/** 钻石下潜的甲门: 护甲点 ≥8 或穿着胸甲。 */
export function chestTierArmor(names) {
    return armorPoints(names) >= DIAMOND_ARMOR_MIN_POINTS || (names || []).some(n => /_chestplate$/.test(n));
}
// ★T-0170 (监工: 剑排在胸/腿之后、盔/靴之前): 已有铁镐时防护序插入铁剑 (2 锭), 已有铁+剑则跳过。
export const PROTECTION_ORDER_WITH_SWORD = [SHIELD_PIECE, ['iron_chestplate', 8], ['iron_leggings', 7], ['iron_sword', 2], ['iron_helmet', 5], ['iron_boots', 4]];
const IRON_PLUS_SWORD_RE = /^(iron|diamond|netherite)_sword$/;
/** 按防护优先序挑下一件: 跳过已有(穿着或背包里)的, 挑铁料预算造得起的第一件; 都造不起 → null。
 *  withSword: 已有铁镐 → 序里含铁剑 (haveNames 里有铁+剑即视为已有)。 */
/** shieldBudget: 盾不吃铁镐预留额 → 调用方传未扣预留的铁总量 (默认同 budget)。 */
export function nextProtectionPiece(haveNames, budget, { withSword = false, shieldBudget = budget } = {}) {
    const names = haveNames || [];
    const have = new Set(names.map(n => (pieceOf(n) || {}).slot).filter(Boolean));
    const hasGoodSword = names.some(n => IRON_PLUS_SWORD_RE.test(n));
    for (const [name, cost] of (withSword ? PROTECTION_ORDER_WITH_SWORD : PROTECTION_ORDER)) {
        if (name === 'iron_sword') { if (!hasGoodSword && cost <= budget) return [name, cost]; continue; }
        if (name === 'shield') { if (!names.includes('shield') && cost <= shieldBudget) return [name, cost]; continue; }
        const slot = pieceOf(name).slot;
        if (have.has(slot)) continue;
        if (cost <= budget) return [name, cost];
    }
    return null;
}
/** 盾在副手 (slot 45) 或背包里。 */
export function hasShield(bot) {
    try { return !!((bot.inventory.slots[45] && bot.inventory.slots[45].name === 'shield') || bot.inventory.items().some(i => i.name === 'shield')); } catch (e) { return false; }
}
/** 防护序"已有"名单: 穿着的甲 + 背包里的甲/剑/盾 + 副手。 */
export function protectionHaveNames(bot) {
    const out = [...equippedArmorNames(bot)];
    try { for (const i of bot.inventory.items()) if (/_(helmet|chestplate|leggings|boots|sword)$|^shield$/.test(i.name || '')) out.push(i.name); } catch (e) {}
    try { const o = bot.inventory.slots[45]; if (o && o.name) out.push(o.name); } catch (e) {}
    return out;
}
/** keepInventory=false 时钻石下潜前置; keepInventory 为 true/未知 → 不加门。
 *  ★T-0229: 盾也算一档防护 — 胸甲档 + 有盾才下深层 (shield 不传 = 旧口径, 只看胸甲档)。 */
export function diamondArmorReady(equippedNames, keepInvOff, { shield = true } = {}) {
    if (keepInvOff !== true) return true;
    return chestTierArmor(equippedNames) && !!shield;
}

/** ★T-0192 夜间"先甲后钻"判据 (纯函数, 原在 modes.js computeNightPlan 闭包内): 铁镐在手 + 安全 (无可动敌对、food>6、有台路、
 *  非封死、能就地冶炼) + 防护序里有造得起的下一件 (胸>腿>铁剑>盔>靴) + 燃料或现成锭够 → 夜里冶炼造甲, 排在整夜下矿前。 */
export function armorNightWarranted({ hasIronPick, actionable = 0, food = 20, hasTablePath, stuckMob = false, canSmeltHere, armorHave = [], rawIron = 0, ingots = 0, fuelUnits = 0 }) {
    return !!hasIronPick && actionable === 0 && food > 6 && !!hasTablePath && !stuckMob && !!canSmeltHere
        && !!nextProtectionPiece(armorHave, rawIron + ingots, { withSword: true })
        && (ingots >= 4 || fuelUnits >= 4);
}

/** ★T-0195 (监工拍板, death #13 00:23:44Z: 1 件甲 + 石剑白天下采铁, 开放洞穴里被骷髅射杀): keepInventory=false 且没有胸甲档
 *  (护甲点 <8 且未穿胸甲) → 采铁/夜挖只走自挖封闭隧道, 破入天然空腔即封口换向, 不看"16 格内有敌对" (暗处随时刷骷髅)。
 *  有胸甲后恢复"有敌对才封"。策略由决策层每拍写 bot._cavitySealAlways, skills.sealCavityBreach 认它。 */
export function cavitySealAlways(equippedNames, keepInvOff) {
    return keepInvOff === true && !chestTierArmor(equippedNames);
}
