// ★T-0151 先甲后钻 (监工拍板 10-10, 用户排序"镐 > 装备": 铁镐到手下一步就是装备; GET_ARMOR 只白天是时段闸不是优先级)。
// 证据: 19:52Z 第三局铁镐刚造好, bot 无甲夜里直接 mineDiamonds 下深层, 背包 11 粗铁闲置; keepInventory=false →
//   无甲下深层是最贵的赌注 (历史死亡 86% 无甲)。
// ① 防护优先序 (胸 > 腿 > 盔 > 靴): 能造几件造几件 (每件挑造得起的最高防护);
// ② keepInventory=false 时钻石下潜要求护甲点 ≥8 或已穿胸甲; keepInventory=true 不加门。
export const PROTECTION_ORDER = [['iron_chestplate', 8], ['iron_leggings', 7], ['iron_helmet', 5], ['iron_boots', 4]];
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
/** 按防护优先序挑下一件: 跳过已有(穿着或背包里)的, 挑铁料预算造得起的第一件; 都造不起 → null。 */
export function nextProtectionPiece(haveNames, budget) {
    const have = new Set((haveNames || []).map(n => (pieceOf(n) || {}).slot).filter(Boolean));
    for (const [name, cost] of PROTECTION_ORDER) {
        const slot = pieceOf(name).slot;
        if (have.has(slot)) continue;
        if (cost <= budget) return [name, cost];
    }
    return null;
}
/** keepInventory=false 时钻石下潜前置; keepInventory 为 true/未知 → 不加门。 */
export function diamondArmorReady(equippedNames, keepInvOff) {
    if (keepInvOff !== true) return true;
    return chestTierArmor(equippedNames);
}
