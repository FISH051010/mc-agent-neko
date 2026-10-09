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

// ★T-0131 重力柱沉降 (死于窒息实录 10-10 18:40:49 @100,66,-39: mobility SEALED 脱困 dig=gravel →
//   18:40:50 ctrl=forward 走进刚挖开的格 → 上方砂砾柱塌落埋头 → suffocation, hp=1, 丢全套铁装)。
//   人类做法: 挖开砂砾后看一眼头顶 — 柱子没塌完就等它落定、把落下来的再挖掉, 落干净才进那一格。
export const GRAVITY_BLOCK_RE = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]*concrete_powder|anvil|chipped_anvil|damaged_anvil)$/;
const isGravity = (b) => !!(b && GRAVITY_BLOCK_RE.test(b.name || ''));
const up = (p, dy) => (typeof p.offset === 'function' ? p.offset(0, dy, 0) : { x: p.x, y: p.y + dy, z: p.z });

/** Contiguous gravity blocks stacked directly above `pos` (pos+1 upward). */
export function gravityColumnAbove(blockAt, pos, maxUp = 16) {
    let n = 0;
    for (let dy = 1; dy <= maxUp; dy++) { if (isGravity(blockAt(up(pos, dy)))) n++; else break; }
    return n;
}

/** A falling_block entity still dropping inside the column over `pos`. */
export function fallingBlockInColumn(entities, pos, r = 0.9) {
    return Object.values(entities || {}).some(e => e && /falling_block|falling_sand/.test(e.name || '') && e.position
        && Math.abs(e.position.x - (pos.x + 0.5)) <= r && Math.abs(e.position.z - (pos.z + 0.5)) <= r && e.position.y >= pos.y - 0.5);
}

/** Does opening `pos` (its block is about to be / was just dug) expose the bot to a collapsing column? */
export function gravityHazard(blockAt, pos, dugName = '') {
    return GRAVITY_BLOCK_RE.test(dugName || '') || gravityColumnAbove(blockAt, pos) > 0;
}

/** After digging `cell`, wait for its gravity column to finish collapsing, re-digging whatever lands in the
 *  cell, until the cell is open with nothing falling and no gravity block directly over it.
 *  Deps injected (blockAt/entities/dig/sleep) so the timing logic is testable without a server. */
export async function settleGravityColumn({ blockAt, entities, dig, sleep, cell, maxRounds = 12, waitMs = 300 }) {
    let redug = 0;
    for (let round = 0; round < maxRounds; round++) {
        await sleep(waitMs);
        const b = blockAt(cell);
        if (isGravity(b)) { try { await dig(b); redug++; } catch (e) {} continue; }
        if (b && b.boundingBox === 'block') return { ok: false, redug, reason: 'cell re-filled by non-gravity block' };
        if (fallingBlockInColumn(entities(), cell)) continue;
        if (isGravity(blockAt(up(cell, 1)))) continue;   // unsupported → about to fall next tick
        return { ok: true, redug };
    }
    return { ok: false, redug, reason: 'column still collapsing' };
}
