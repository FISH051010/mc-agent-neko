// ★T-0284 (death #56, 10-11 07:07:06Z): at dusk the go_to_bed_sleep instinct (modes world_model tick, act not awaited) fired
// while the kernel ran smeltSafe for NIGHT_SMELT_IRON at y18 in a cave, and called goToPosition toward a 'bed' landmark
// 272 blocks away at y-15 (GoalNear 163,-15,-259, mine_motion seq 15). Two drivers: the instinct's goto re-set the pathfinder
// goal over smeltSafe's own walk (07:06:41.294), sprinted the body across the cave while smeltSafe dug/placed around it, the
// bot dropped 20 blocks (hp 20→1, 07:06:46), and the walk carried on at hp 1 for 11s (path=1 forward,sprint, act '-') into
// a creeper. The instinct is execute-first by design (C331), but only when the decision layer is idle — never over a live
// commitment (DUSK_GO_BED is the kernel's own sleep executor), never hurt, never a cross-map dusk run; and its walk stops
// the moment the body is hurt.
export const SLEEP_INSTINCT_MAX_DIST = 64;
export const SLEEP_INSTINCT_MIN_HP = 10;
export const SLEEP_INSTINCT_IDLE_KINDS = /^(FREE_PLAY|IDLE_FALLBACK)$/;

export function goSleepInstinctEligible(w, b, now = Date.now()) {
    try {
        const t = w && w.time;
        if (!t || (t.phase !== 'dusk' && t.phase !== 'night')) return false;
        if (w.threat && (w.threat.actionable | 0) > 0) return false;
        // the kernel owns the body while it holds a real commitment (incl. every NIGHT_/DUSK_ plan and DUSK_GO_BED itself)
        const c = b && b._commitment;
        if (c && c.kind && !SLEEP_INSTINCT_IDLE_KINDS.test(c.kind)) return false;
        if (b && (b._healLatch || (Number.isFinite(b.health) && b.health < SLEEP_INSTINCT_MIN_HP))) return false;
        // bed-failure memo: a failed sleep within 3min means walking back will fail again
        if (b && b._bedSleepFailAt && now - b._bedSleepFailAt < 180000) return false;
        const lm = w.landmarks || {};
        const tgt = lm.bed || lm.village;
        if (!tgt) return false;
        const d = Number.isFinite(tgt.dist) ? tgt.dist : Infinity;
        if (d > SLEEP_INSTINCT_MAX_DIST) return false;
        // 用户令 2026-07-08: near bed (≤15) all night; farther only at dusk
        if (d > 15 && t.phase !== 'dusk') return false;
        return true;
    } catch (e) { return false; }
}

/** Watch a walk: once hp falls `drop` below where it started (a fall, a hit) or under `floor`, halt it now (setGoal(null) acts
 *  immediately; stop() only sets a deferred flag) and let the reflexes / HEAL take the body. */
export function abortWalkOnHurt(bot, { drop = 4, floor = SLEEP_INSTINCT_MIN_HP, pollMs = 250, onAbort = null } = {}) {
    const hp0 = bot && bot.health;
    let fired = false;
    const iv = setInterval(() => {
        try {
            const hp = bot.health;
            if (fired || !Number.isFinite(hp) || !Number.isFinite(hp0)) return;
            if (hp <= hp0 - drop || hp < floor) {
                fired = true;
                try { bot.pathfinder && bot.pathfinder.setGoal(null); } catch (e) {}
                try { bot.clearControlStates && bot.clearControlStates(); } catch (e) {}
                try { onAbort && onAbort(hp0, hp); } catch (e) {}
            }
        } catch (e) {}
    }, pollMs);
    return { stop: () => clearInterval(iv), fired: () => fired };
}
