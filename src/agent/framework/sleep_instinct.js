// ★T-0284 (death #56, 10-11 07:07:06Z): at dusk the go_to_bed_sleep instinct (modes world_model tick, act not awaited) fired
// while the kernel ran smeltSafe for NIGHT_SMELT_IRON at y18 in a cave, and called goToPosition toward a 'bed' landmark
// 272 blocks away at y-15 (GoalNear 163,-15,-259, mine_motion seq 15). Two drivers: the instinct's goto re-set the pathfinder
// goal over smeltSafe's own walk (07:06:41.294), sprinted the body across the cave while smeltSafe dug/placed around it, the
// bot dropped 20 blocks (hp 20→1, 07:06:46), and the walk carried on at hp 1 for 11s (path=1 forward,sprint, act '-') into
// a creeper. The instinct is execute-first by design (C331), but only when the decision layer is idle — the shared travel
// guard (instinct_travel.js, T-0290) decides that; this adds the sleep-specific rules.
import { instinctMayTravel, abortWalkOnHurt, INSTINCT_TRAVEL_MAX_DIST, INSTINCT_TRAVEL_MIN_HP, INSTINCT_IDLE_KINDS } from './instinct_travel.js';

export { abortWalkOnHurt };
export const SLEEP_INSTINCT_MAX_DIST = INSTINCT_TRAVEL_MAX_DIST;
export const SLEEP_INSTINCT_MIN_HP = INSTINCT_TRAVEL_MIN_HP;
export const SLEEP_INSTINCT_IDLE_KINDS = INSTINCT_IDLE_KINDS;

/** Distance to the sleep target the instinct would walk to (bed, else village), Infinity when unknown. */
export function sleepTargetDist(w) {
    const lm = (w && w.landmarks) || {};
    const tgt = lm.bed || lm.village;
    return tgt && Number.isFinite(tgt.dist) ? tgt.dist : Infinity;
}

export function goSleepInstinctEligible(w, b, now = Date.now()) {
    try {
        const t = w && w.time;
        if (!t || (t.phase !== 'dusk' && t.phase !== 'night')) return false;
        if (w.threat && (w.threat.actionable | 0) > 0) return false;
        // bed-failure memo: a failed sleep within 3min means walking back will fail again
        if (b && b._bedSleepFailAt && now - b._bedSleepFailAt < 180000) return false;
        const lm = w.landmarks || {};
        if (!(lm.bed || lm.village)) return false;
        const d = sleepTargetDist(w);
        // 用户令 2026-07-08: near bed (≤15) all night; farther only at dusk
        if (d > 15 && t.phase !== 'dusk') return false;
        // T-0290 shared guard: live commitment yields / hurt or healing / cross-map
        return instinctMayTravel(b, { dist: d });
    } catch (e) { return false; }
}
