// Stateful trackers + fire predicates for botwatch's stall detectors, split out of botwatch.mjs
// (which has top-level side effects) so test/botwatch_trackers.test.mjs can pin them (回归测试钉死).
// Behavior is unchanged — see botwatch.mjs's detector table for the full rationale of each.

// ── FROZEN-ALIVE tracker (T-0058): pos+hp identical for how long, plus events.log silence age. ──
// eventsMtimeMs() → mtime of events.log (throws if missing → treated as silent forever).
export function makeFrozenAliveTracker(eventsMtimeMs) {
    let key0 = null, since = null;
    return (s, t) => {
        if (since === null) since = t;
        const key = s.v ? `${s.v.x},${s.v.y},${s.v.z}|${s.hp}` : null;
        if (key !== key0) { key0 = key; since = t; }
        let eventsAgeS = 1e9;
        try { eventsAgeS = (t - eventsMtimeMs()) / 1000; } catch {}
        return { frozenMs: key ? (t - since) : 0, eventsAgeS };
    };
}
// ★T-0062: a LEGIT sealed night hold — night + real roof + nothing that can reach the bot + alive and
// not being hit, per a FRESH world model (modes rewrites world_model.json every 2s from inside the bot
// loop). Standing still with a quiet events.log is exactly what such a hold looks like (live 10-10 00:09
// @71,65,-2: "sealed night hold" every 30s in progress, events silent 128s → false FROZEN-ALIVE #2018).
// Same exemption shape mobility-stuck uses. A real frozen body still fires: hp 0 / taking damage /
// stale wm / daylight / exposed / actionable threat all void the exemption.
export const legitNightHold = (s) => {
    const wm = s && s.wm;
    if (!wm || !wm.time || wm.time.isDay !== false) return false;
    if (!wm.cover || wm.cover.coverReal !== true) return false;
    const th = wm.threat || {};
    if ((th.actionable | 0) > 0 || th.takingDamage) return false;
    if (!(Number(s.hp) > 0)) return false;
    const t = s.t || Date.now();
    return Number.isFinite(wm.ts) && t - wm.ts <= 20000;
};
// 'frozen data + live writer' hang: pinned >=2min AND events.log silent >=120s, not a legit night hold.
export const frozenAliveActive = (s) => !!(s._frozen && s._frozen.frozenMs >= 2 * 60000 && s._frozen.eventsAgeS >= 120)
    && !legitNightHold(s);

// ── WEDGE / FALSE-HOLD tracker (T-0062): pos-pinned time on a ~3-block cell + hp drop during pin. ──
export function makeWedgeTracker() {
    let key0 = null, since = null, hpMax = 0;
    return (s, t) => {
        if (since === null) since = t;
        // ~3-block cell so micro-jitter (bobbing in a niche / edge-wedge) still counts as pinned
        const key = s.v ? `${Math.round(s.v.x / 3)},${Math.round(s.v.y / 3)},${Math.round(s.v.z / 3)}` : null;
        if (key !== key0) { key0 = key; since = t; hpMax = s.hp || 0; }
        else if ((s.hp || 0) > hpMax) hpMax = s.hp;   // track the peak so falls/hits show as a drop
        return { pinnedMs: key ? (t - since) : 0, hpDrop: Math.max(0, hpMax - (s.hp || 0)) };
    };
}
// fire: pinned>=10min AND (hpDrop>=3 OR pinned>=20min), regardless of events/"covered" self-report.
export const falseHoldActive = (s) => !!(s._wedge && s._wedge.pinnedMs >= 10 * 60000
    && (s._wedge.hpDrop >= 3 || s._wedge.pinnedMs >= 20 * 60000)
    && !/sleep|^bed$/i.test(s.skill || ''));
