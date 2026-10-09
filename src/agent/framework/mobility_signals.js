// ★T-0121 采矿心跳 (MAROONED 误判豁免): 地下 branchMine/mineDown 打矿道 = 有目的工程, 不是被困。
// 实录 10-10 16:47:19→16:50:19: bot 在 y23 整晚挖矿 (粗铁 8→12), mobility 因"90s 没挪 20 格 + 寻路失败"
// 判 MAROONED 并 sticky 180s, march 42 次抢挖掘槽 ("dig slot busy … heldBy=branchMine:ore-window") = 拔河。
// 与凿崖心跳 (bot._climbingAt) 同理: 有非反射技能在持续挖 → 不判被困。反射自己的挖 (mobility:/unstuck:)
// 不算, 否则 march 修路会自己给自己续命。挖掘槽 = bot._bodyDigLockOwner / _bodyDigLockUntil (acquire 时 +6s)。
export const PURPOSEFUL_DIG_WINDOW_MS = 15000;
export function purposefulDigActive(bot, now = Date.now()) {
    try {
        const _sd = Number(bot && bot._lastSkillDigAt) || 0;
        if (_sd && now - _sd < PURPOSEFUL_DIG_WINDOW_MS) return true;   // ★T-0163
        const owner = String((bot && bot._bodyDigLockOwner) || '');
        if (!owner || /^(mobility|unstuck):/.test(owner)) return false;
        const until = Number(bot._bodyDigLockUntil) || 0;
        return until > now - PURPOSEFUL_DIG_WINDOW_MS;
    } catch (e) { return false; }
}

// ★T-0163 (live 21:26:43-46): mineDown / chopWood / breakBlockAt dig through bot.dig without ever taking the dig slot,
//   so the slot-only signal above read "nobody working" mid-mineDown and a SEALED escape episode tunnelled 20 blocks.
//   The mine_motion_audit bot.dig wrapper sees EVERY dig — it stamps skill digs here. Reflex digs (action label
//   mode:mobility / mode:unstuck, or the slot held by a mobility:/unstuck: owner) are excluded, else an escape or
//   march would keep itself "working".
export function noteSkillDig(bot, actionLabel, now = Date.now()) {
    if (!bot) return;
    if (/^mode:(mobility|unstuck)$/.test(String(actionLabel || ''))) return;
    if (/^(mobility|unstuck):/.test(String(bot._bodyDigLockOwner || ''))) return;
    bot._lastSkillDigAt = now;
}

// ★T-0174 挖掘槽统一规则 (death #10 溺死 + T-0163 同类抢槽): 救命类挖掘 (ENTOMBED/SEALED 脱困、溺水中、
//   窒息自救) 可以抢断任何任务类挖掘 —— 对当前挖掘 stopDigging 并接管槽位; 救命挖掘持槽期间 bot.dig 总闸
//   拒绝新的任务挖掘 (否则任务被打断后下一拍又开挖)。救命挖掘自身带 bot._rescueDigToken 放行。
//   槽位约定沿用 T-0121/T-0163: bot._bodyDigLockOwner ('mobility:<why>' / 'unstuck:<why>' = 反射, 其余 = 技能)。
export const RESCUE_DIG_RE = /^mobility:(ENTOMBED|SEALED|SUFFOC|DROWN)/;
export function isRescueDig(owner, drowning = false) {
    return !!drowning || RESCUE_DIG_RE.test(String(owner || ''));
}
/**
 * 救命挖掘申请槽位时能否抢断当前持有者: 自己是救命挖掘 + 【正处于危险中】(溺水 / 刚掉血) + 持有者不是救命挖掘。
 * ★T-0174 实机收紧 (22:45 满血 O2=20 白天, surfaceUp 在 1×1 竖井里上爬, mobility 把竖井判 ENTOMBED 去抢槽 →
 * 两边互相 'Digging aborted'): 没危险时被困挖出无理由打断正在推进的挖掘 (T-0163 精神: 有目的挖掘≠被困)。
 */
export function rescueMayPreempt({ claimantOwner, drowning, holderOwner, inDanger }) {
    if (!(drowning || inDanger)) return false;
    return isRescueDig(claimantOwner, drowning) && !RESCUE_DIG_RE.test(String(holderOwner || ''));
}
/** bot.dig 总闸: 发生过抢断(preemptUntil 未过期)时, 不带救命令牌的挖掘一律拒绝。平时救命挖掘正常持槽不封锁别人。 */
export function taskDigBlockedByRescue({ preemptUntil, now = Date.now(), rescueToken }) {
    if (rescueToken) return false;
    return Number(preemptUntil) > now;
}

// ★T-0182 让位必须有人接 (监工通律: "让位/交出身体以接收方此刻已持有为前提"): 两次致死都是"让位没人接" —
//   T-0168 self_defense 无武器让给 shouldFlee, shouldFlee 豁免 → 零反射; T-0180 swim 让给 mobility, mobility 12s
//   后才接。逐个修让位条件之外, 再加一道常驻兜底: 处于危险 (≤2.5s 内掉血, 或头在水里且 O2<10) 且 ≥3s 无人掌舵
//   (无非常驻 mode active / 没在挖 / 寻路不动 / 移动键全松) → 收回控制: 水里先上游, 暴露地表逃, 地下/封闭封坑。
export const UNOWNED_DANGER_MS = 3000;
export function unownedDangerAction({ unownedMs, hurtRecently, headInWater, oxygen, exposed, threshold = UNOWNED_DANGER_MS }) {
    const drowning = !!headInWater && Number.isFinite(oxygen) && oxygen < 10;
    if (!(hurtRecently || drowning)) return null;
    if (!(unownedMs >= threshold)) return null;
    if (headInWater) return 'swim';
    return exposed ? 'flee' : 'bunker';
}

// ★T-0182 普查补"接收方就绪"前提 (纯判据, modes 调用):
/** #3 tableRecoveryHold 等"挖出原地让位 hold": 溺水中 / 刚挨打 → 不得 hold (否则封顶水袋无人掌舵)。 */
export function dangerBlocksHold({ headInWater, msSinceDamage }) {
    // (O2 deliberately not used: bot.oxygenLevel goes stale at -1..2 on dry land after a drowning death — 23:03 hotfix)
    if (headInWater) return true;
    return Number.isFinite(msSinceDamage) && msSinceDamage < 3000;
}
/** #10 armoredZombieBrawl 把身体交给 self_defense: 接收方得真能打 —— 有武器(含可用后备镐)且不是一群(≤2 只贴脸)。 */
export function brawlHandoffReady({ armed, pointBlankZombies }) {
    return !!armed && pointBlankZombies >= 1 && pointBlankZombies <= 2;
}
/** #1 self_preservation 让位给 MAROONED/ENTOMBED: 近身威胁、着火/岩浆、开放水体溺水时都不让 (那些是 sp 自己的活)。 */
export function marchYieldAllowed({ closeThreat, inLavaOrFire, headInWater, oxygen }) {
    if (closeThreat || inLavaOrFire) return false;
    if (headInWater && Number.isFinite(oxygen) && oxygen <= 14) return false;
    return true;
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

// ★T-0143 环境感知的挖掘超时: guardedDig 原用 block.digTime(heldType) 估时 — 省略 inWater / notOnGround 两个
//   各 ×5 的惩罚, 而 bot.dig 实际按 bot.digTime(block) 挖(mineflayer 把水中/悬空/附魔/药水都算进去, water_navigation
//   还给它打了水下补丁)。实录 10-10 03:12:24-35 ENTOMBED 刚出水浮着(g=0)挖石: 估 ~3s, 真 ~15s → 'dig-timeout'
//   截断白挖 ×4。超时须与真实挖掘时间同源。上限 30s(落在 45s 的挖出 burst 截止内)。
export const MOBILITY_DIG_TIMEOUT_CAP_MS = 30000;
export function mobilityDigTimeoutMs(bot, block) {
    let dt = NaN;
    try { if (typeof bot.digTime === 'function') dt = bot.digTime(block); } catch (e) {}
    if (!Number.isFinite(dt) || dt <= 0) {
        try {
            const e = bot.entity || {};
            dt = block.digTime(bot.heldItem ? bot.heldItem.type : null, false, !!e.isInWater, !e.onGround);
        } catch (e) {}
    }
    if (!Number.isFinite(dt) || dt <= 0) return 5000;
    return Math.min(MOBILITY_DIG_TIMEOUT_CAP_MS, Math.round(dt * 1.4) + 1500);
}

// ★T-0154 残血移动档 (监工规格): 死 #6 20:03:31 fall — hp=1(饥饿)时 MAROONED 行军在树冠里 forward+jump 爬到 y76.2,
//   随即踩空落回 ~y73: 从跳跃顶点算 >3 格 = 1 点摔伤 = 致命。与 #3(残血挖砂砾窒息)同族: 残血时做了满血才扛得住的动作。
//   统一原语: hp<=LOW_HP 时 不跳跃前进、落差<=1、不 parkour(跳弧下方深坑)。所有移动路径过它
//   (pathfinder: Movements 访问器按血量实时钳制; mobility: MAROONED 行军残血 hold)。
export const LOW_HP_MOVE = 6;
export function lowHpMovementProfile(hp) {
    const h = Number.isFinite(hp) ? hp : 20;
    const low = h <= LOW_HP_MOVE;
    return { low, allowJump: !low, maxDropDown: low ? 1 : null, allowParkour: !low };
}

// ★C234 pin-breaker backoff (moved verbatim from modes.js reflex_watchdog): re-kicking a pinned stack every minute
// was pure churn (cancel → bridge re-arms the same sticky in 8s → re-deadlock). Interval grows with each
// ineffective kick 1m→2m→4m→8m cap; after 3 kicks it ESCALATES to one loud persistent-pin signal. PURE.
export function pinKickIntervalMs(kickCount) {
    return Math.min(60000 * Math.pow(2, kickCount || 0), 8 * 60 * 1000);
}
export function pinKickEscalates(kicks) {
    return kicks > 3;
}
