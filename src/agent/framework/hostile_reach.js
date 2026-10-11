// ★T-0222 可达/视线敌对谓词 — every "hostile near → wait / skip / defer" gate uses this one definition.
//
// Live 10-10 03:57→04:10+ @27,13,29 (y13, hp7 food6): ONE underground skeleton with no line of sight to the bot
// (self_defense already judged it 'ranged-unreachable-trap') held replenishKit's surfaceUp gate (hostiles16), quickMeal /
// exitPit (8b), GET_BED (16b)… for 12+ minutes. Each gate counted RAW hostiles in a radius, reachable or not. A human
// ignores the skeleton rattling behind the wall and gets on with the job.
//
// Rules (pure — reads only bot.entity, bot.entities, bot.blockAt; no mode state, so world_model and skills share it):
//   · beyond r                                  → not a threat here
//   · within 3 blocks                           → always (it will be on us regardless of walls)
//   · ranged (skeleton/stray/bogged/pillager/…) → only with line of sight (eye → eye, solid blocks occlude)
//   · melee                                     → line of sight AND |dy| ≤ 3 (on our level, can actually close in)
//   Unloaded chunks read as "not solid" → LOS assumed → counted (conservative).
import Vec3 from 'vec3';

export const HOSTILE_NAME_RE = /^(zombie|zombie_villager|husk|drowned|skeleton|stray|bogged|wither_skeleton|creeper|spider|cave_spider|witch|pillager|vindicator|evoker|vex|ravager|enderman|endermite|silverfish|slime|magma_cube|phantom|blaze|ghast|hoglin|zoglin|piglin_brute|guardian|elder_guardian|breeze|warden)$/;
const RANGED_RE = /^(skeleton|stray|bogged|pillager|witch|blaze|ghast|evoker|breeze)$/;
export const ALWAYS_NEAR = 3;
export const MELEE_DY = 3;

export function isHostileEntity(e) {
    if (!e || !e.name) return false;
    if (e.name === 'iron_golem' || e.name === 'snow_golem') return false;
    return HOSTILE_NAME_RE.test(e.name) || e.type === 'hostile';
}

/** True when no solid block lies on the segment a→b (sampled every `step` blocks, endpoints' own cells excluded). */
export function lineOfSight(bot, a, b, step = 0.4) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    const n = Math.ceil(len / step);
    const a0 = `${Math.floor(a.x)},${Math.floor(a.y)},${Math.floor(a.z)}`, b0 = `${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`;
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = Math.floor(a.x + dx * t), y = Math.floor(a.y + dy * t), z = Math.floor(a.z + dz * t);
        const key = `${x},${y},${z}`;
        if (key === a0 || key === b0) continue;
        let blk = null;
        try { blk = bot.blockAt(new Vec3(x, y, z)); } catch (e) { blk = null; }
        if (blk && blk.boundingBox === 'block') return false;
    }
    return true;
}

const eyeOf = (ent, h = 1.62) => {
    const p = ent.position;
    const eh = Number.isFinite(ent.height) ? ent.height * 0.85 : h;
    return { x: p.x, y: p.y + eh, z: p.z };
};

/** Is this hostile an actual threat to the bot within r? (see rules above) */
export function hostileActionable(bot, e, r = 16) {
    try {
        if (!bot || !bot.entity || !e || e === bot.entity || !e.position || !isHostileEntity(e)) return false;
        const me = bot.entity.position;
        const d = e.position.distanceTo ? e.position.distanceTo(me) : Math.hypot(e.position.x - me.x, e.position.y - me.y, e.position.z - me.z);
        if (d > r) return false;
        if (d <= ALWAYS_NEAR) return true;
        const los = lineOfSight(bot, { x: me.x, y: me.y + 1.62, z: me.z }, eyeOf(e));
        if (RANGED_RE.test(e.name || '')) return los;
        return los && Math.abs(e.position.y - me.y) <= MELEE_DY;
    } catch (err) { return true; }   // fail safe: treat as a threat
}

/** Count of actionable hostiles within r. Drop-in replacement for the raw `hostilesNear(r)` gates. */
export function hostileActionableNear(bot, r = 16) {
    let n = 0;
    try {
        for (const id in (bot && bot.entities) || {}) if (hostileActionable(bot, bot.entities[id], r)) n++;
    } catch (e) {}
    return n;
}

// ★T-0243 (挂 T-0242, 监工拍板, 10-11 02:38:59Z 死亡: GET_IRON_ARMOR_SET 按 threat.actionable (可达/视线) 放行, 刚下挖 3 格时地面僵尸被判不可达;
//   mineDown 却按原始距离 "hostile within 4" 让位 → 1.5s 一轮 派发↔让位, 6 只僵尸围死)。下挖本身在 4 格内有怪时就危险, 不看可达性:
//   决策层下挖类提案与 mineDown 的让位判据统一用这一个谓词。
export const DESCENT_HOSTILE_R = 4;
/** r 内 (3D 距离) 原始敌对数 — 不看视线/可达。 */
export function hostileRawNear(bot, r = DESCENT_HOSTILE_R) {
    let n = 0;
    try {
        const me = bot && bot.entity && bot.entity.position;
        if (!me) return 0;
        for (const id in (bot.entities || {})) {
            const e = bot.entities[id];
            if (!e || e === bot.entity || !e.position || !isHostileEntity(e)) continue;
            const d = e.position.distanceTo ? e.position.distanceTo(me) : Math.hypot(e.position.x - me.x, e.position.y - me.y, e.position.z - me.z);
            if (d < r) n++;
        }
    } catch (e) {}
    return n;
}
