// ★T-0290 (T-0284 族, death #56): the ONE movement channel that bypasses the kernel is an instinct's act — runInstinct
// launches it NOT awaited, outside execute()/the arbiter/the reflex body gate (act_trace shows act='-'). Modes that move the
// body through execute() are arbitrated; self_preservation/self_defense/unstuck are short-range survival. So the shared
// travel guard lives here and runInstinct enforces it for every instinct that declares `travels: true`:
//   1. a live kernel commitment (anything but idle FREE_PLAY / IDLE_FALLBACK) owns the body → the instinct yields;
//   2. hurt (hp < floor) or healing (_healLatch) → it does not start;
//   3. no cross-map runs (dist > maxDist);
//   and while it walks, getting hurt (a fall, a hit) halts the walk at once (abortWalkOnHurt).
export const INSTINCT_TRAVEL_MAX_DIST = 64;
export const INSTINCT_TRAVEL_MIN_HP = 10;
export const INSTINCT_IDLE_KINDS = /^(FREE_PLAY|IDLE_FALLBACK)$/;

/** Why an instinct may NOT move the body now (string), or null when it may. */
export function instinctTravelVeto(bot, { dist = 0, maxDist = INSTINCT_TRAVEL_MAX_DIST, minHp = INSTINCT_TRAVEL_MIN_HP } = {}) {
    try {
        const c = bot && bot._commitment;
        if (c && c.kind && !INSTINCT_IDLE_KINDS.test(c.kind)) return `commitment:${c.kind}`;
        if (bot && bot._healLatch) return 'healing';
        if (bot && Number.isFinite(bot.health) && bot.health < minHp) return `hp${bot.health}<${minHp}`;
        const d = Number.isFinite(dist) ? dist : Infinity;
        if (d > maxDist) return `dist${Math.round(d)}>${maxDist}`;
        return null;
    } catch (e) { return 'guard-error'; }
}

export function instinctMayTravel(bot, opts = {}) { return instinctTravelVeto(bot, opts) === null; }

/** Watch a walk: once hp falls `drop` below where it started or under `floor`, halt it now (setGoal(null) acts at once;
 *  stop() only sets a deferred flag) and hand the body to the reflexes / HEAL. */
export function abortWalkOnHurt(bot, { drop = 4, floor = INSTINCT_TRAVEL_MIN_HP, pollMs = 250, onAbort = null, yieldIf = null } = {}) {
    const hp0 = bot && bot.health;
    let fired = false;
    const iv = setInterval(() => {
        try {
            const hp = bot.health;
            if (fired || !Number.isFinite(hp) || !Number.isFinite(hp0)) return;
            // yieldIf: a reason the walk must hand the body back mid-way (e.g. the kernel committed meanwhile)
            let why = null;
            try { why = yieldIf ? yieldIf() : null; } catch (e) { why = null; }
            if (hp <= hp0 - drop || hp < floor || why) {
                fired = true;
                try { bot.pathfinder && bot.pathfinder.setGoal(null); } catch (e) {}
                try { bot.clearControlStates && bot.clearControlStates(); } catch (e) {}
                try { onAbort && onAbort(hp0, hp, why); } catch (e) {}
            }
        } catch (e) {}
    }, pollMs);
    return { stop: () => clearInterval(iv), fired: () => fired };
}
