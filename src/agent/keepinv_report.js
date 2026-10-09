// 死亡播报的 keepInventory 文案 + 复活后的实测校正。
//
// ★2026-10-09: 死亡告警曾硬编码「死亡不掉落，物品已保留」(07-08 那个世界 keepInventory 确实开着,
//   而游戏内 /gamerule 查询总被误答)。新世界 keepInventory=false, bot 首死全套木镐掉光, 告警却仍说
//   "已保留" —— 对话 LLM 和玩家都被误导。现在: 文案按 keepinv.json 的核实值走; 每次复活再用
//   "死前背包 vs 复活后背包" 的实测结果覆盖它 —— 查询可能答错, 背包不会。

// value: true | false | null(未核实)
export function deathAlertText(keepInventory) {
    if (keepInventory === true) return '角色阵亡（死亡不掉落，物品已保留），即将重生。';
    if (keepInventory === false) return '角色阵亡，身上物品已掉落在死亡地点（本世界未开 keepInventory），即将重生。';
    return '角色阵亡，即将重生（本世界是否死亡不掉落尚未确认）。';
}

// 死前物品总数 vs 复活后物品总数 → 观测到的 keepInventory。证据不足返回 null (不改写缓存)。
export function observeKeepInventory(preDeathCount, respawnCount) {
    if (!(preDeathCount > 0) || !(respawnCount >= 0)) return null;
    if (respawnCount === 0) return false;
    if (respawnCount >= preDeathCount) return true;
    return null; // 部分丢失 (烧毁/消失等) 不下结论
}

export function countItems(bot) {
    try { return (bot.inventory.items() || []).reduce((s, i) => s + (i.count || 0), 0); } catch (e) { return -1; }
}
