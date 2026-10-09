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

// ★T-0123 挖出 burst 截止时间: ENTOMBED/SEALED 的单次 burst (≤2-3 次挖, 每次挖自带 ≤20s 超时) 里还有
// bot.equip / bot.tool.equipForBlock / lookAt 这类无超时 await — 背包事务不同步时 equip 永不 resolve。
// 实录 10-10 17:00:48: "Entombed — digging out!" 之后再无 "Mode mobility finished" → mobility 一直 active →
// 模式循环停转, mob 状态冻在 ENTOMBED → kernelDriver 对 ENTOMBED 让位 → 3min 零动作, 靠 reflex_watchdog
// pin-kick 才破。截止时间到就放手 (挂住的 await 留在后台, 不再占着模式槽), 状态下一拍重新评估。
export const DIGOUT_BURST_DEADLINE_MS = 45000;
export function withBurstDeadline(fn, ms = DIGOUT_BURST_DEADLINE_MS, onTimeout = () => {}) {
    return async () => {
        let timer = null, timedOut = false;
        const deadline = new Promise(r => { timer = setTimeout(() => { timedOut = true; r(); }, ms); });
        try {
            await Promise.race([Promise.resolve().then(fn), deadline]);
        } finally {
            clearTimeout(timer);
            if (timedOut) { try { onTimeout(); } catch (e) {} }
        }
    };
}
