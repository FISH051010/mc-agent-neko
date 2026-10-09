// ★T-0121 采矿心跳 (MAROONED 误判豁免): 地下 branchMine/mineDown 打矿道 = 有目的工程, 不是被困。
// 实录 10-10 16:47:19→16:50:19: bot 在 y23 整晚挖矿 (粗铁 8→12), mobility 因"90s 没挪 20 格 + 寻路失败"
// 判 MAROONED 并 sticky 180s, march 42 次抢挖掘槽 ("dig slot busy … heldBy=branchMine:ore-window") = 拔河。
// 与凿崖心跳 (bot._climbingAt) 同理: 有非反射技能在持续挖 → 不判被困。反射自己的挖 (mobility:/unstuck:)
// 不算, 否则 march 修路会自己给自己续命。挖掘槽 = bot._bodyDigLockOwner / _bodyDigLockUntil (acquire 时 +6s)。
export const PURPOSEFUL_DIG_WINDOW_MS = 15000;
export function purposefulDigActive(bot, now = Date.now()) {
    try {
        const owner = String((bot && bot._bodyDigLockOwner) || '');
        if (!owner || /^(mobility|unstuck):/.test(owner)) return false;
        const until = Number(bot._bodyDigLockUntil) || 0;
        return until > now - PURPOSEFUL_DIG_WINDOW_MS;
    } catch (e) { return false; }
}
