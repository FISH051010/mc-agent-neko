// ★T-0288 fall probe — WHO put the body over the edge?
// death #56 (10-11 07:06:46Z): the bot dropped 24 blocks (y18 → y-6, -17 hp, no mob) between a smeltSafe furnace-place
// abort and the next dispatch; nothing in the logs said what was driving the body, so the cause could not be fixed.
// At take-off we snapshot the body owner / skill / control keys / pathfinder goal; on landing a drop ≥ minDrop is logged.
// Water ends a "fall" (swimming is not falling). The tracker is pure (testable); installFallProbe wires it to physicsTick.

export const FALL_LOG_MIN_DROP = 5;   // > 3 hurts; 5+ is a real fall worth a line

export function createFallTracker({ minDrop = FALL_LOG_MIN_DROP } = {}) {
    let start = null;
    return {
        /** onGround, inWater: booleans; y: feet y; now: ms; snapshot: () => object (called once, at take-off). → record | null */
        tick({ onGround, inWater, y, now, snapshot }) {
            if (inWater) { start = null; return null; }
            if (!onGround) {
                if (!start) start = { y, at: now, snap: (() => { try { return snapshot ? snapshot() : {}; } catch (e) { return {}; } })() };
                else if (y > start.y) start.y = y;   // jump apex
                return null;
            }
            if (!start) return null;
            const s = start; start = null;
            const drop = s.y - y;
            if (!(drop >= minDrop)) return null;
            return { drop: Math.round(drop * 10) / 10, fromY: Math.round(s.y * 10) / 10, toY: Math.round(y * 10) / 10, ms: now - s.at, ...s.snap };
        },
    };
}

export function installFallProbe(bot, { log, holder } = {}) {
    if (!bot || bot._fallProbeInstalled) return;
    bot._fallProbeInstalled = true;
    const tr = createFallTracker();
    const CTRL = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
    bot.on('physicsTick', () => {
        try {
            const e = bot.entity; if (!e) return;
            const rec = tr.tick({
                onGround: !!e.onGround, inWater: !!(e.isInWater || e.isInLava), y: e.position.y, now: Date.now(),
                snapshot: () => ({
                    hp0: Math.round(bot.health || 0),
                    owner: holder ? holder(bot) : '-',
                    skill: bot._currentSkill || '-',
                    keys: CTRL.filter(k => { try { return bot.getControlState(k); } catch (er) { return false; } }).join('+') || 'none',
                    goal: (() => { try { const g = bot.pathfinder && bot.pathfinder.goal; return g ? g.constructor.name : 'none'; } catch (er) { return '?'; } })(),
                    at: `${Math.floor(e.position.x)},${Math.floor(e.position.y)},${Math.floor(e.position.z)}`,
                }),
            });
            if (rec && log) log(`[fall] drop=${rec.drop} y ${rec.fromY}→${rec.toY} in ${rec.ms}ms from ${rec.at} hp ${rec.hp0}→${Math.round(bot.health || 0)} owner=${rec.owner} skill=${rec.skill} keys=${rec.keys} goal=${rec.goal} (T-0288)`);
        } catch (err) {}
    });
}
