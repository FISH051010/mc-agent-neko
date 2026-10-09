// Stateful trackers + fire predicates for botwatch's stall detectors, split out of botwatch.mjs
// (which has top-level side effects) so test/botwatch_trackers.test.mjs can pin them (回归测试钉死).
// Behavior is unchanged — see botwatch.mjs's detector table for the full rationale of each.
import { STUCK_MOBILITY_RE } from './bb-readers.mjs';

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

// ── SURVIVAL-CHURN tracker (T-0073): a HEALTHY + FREE bot stuck in a survival-reflex loop (kite / circle /
//    dig all night) with pickTier FLAT. Continuous churn time; tier advance or leaving churn resets. ──
export const _REFLEX_RE = /Fighting|Outmatched|digging in|kit(e|ing)|running from|flee|getting out|Drowning|dig(ging)? out|escaping|MLG|clutch|swim|heading for air/i;
export function makeSurvivalChurnTracker() {
    let tier0 = null, since = null;
    return (s, t) => {
        if (since === null) since = t;
        const reflexLines = (s.events || []).filter(l => _REFLEX_RE.test(l)).length;
        const churning = (s.hp != null && s.hp >= 14)
            && !/MAROONED|ENTOMB|POCKET/i.test(s.mob || '')
            && reflexLines >= 8;
        const tier = churning ? (s.pickTier || 'none') : null;
        if (tier !== tier0) { tier0 = tier; since = t; }   // tier advance OR churn-off → reset
        return { churnMs: (churning && tier0 != null) ? (t - since) : 0, reflexLines };
    };
}
export const survivalChurnActive = (s) => !!(s._churn && s._churn.churnMs >= 15 * 60000);

// ── MOBILITY-stuck (T-0027/T-0032): stuck mobility state, but a sealed night hold (night + real roof + no
//    actionable threat) is CORRECT sheltering, not stuck. ──
export const mobilityStuckActive = (s) => STUCK_MOBILITY_RE.test(s.mob || '')
    && !(s.wm && s.wm.time && !s.wm.time.isDay && s.wm.cover && s.wm.cover.coverReal && (!s.threat || (s.threat.actionable | 0) === 0));
// ── MOBILITY-STALE (T-0124): the mobility classifier itself stopped updating. 2026-10-09 16:57Z–17:25Z a missing
//    import threw ReferenceError every tick, swallowed by a bare catch → bot._mobility frozen for 1.5h, kernelDriver
//    froze twice, and no detector noticed (every other detector READS mob and trusted the frozen value).
//    ★2026-10-10 修正 (T-0126 误报): mobility 不是 always-on 观察者 —— 自己在执行、被暂停、或别的模式占着执行槽
//    (例: self_preservation 处理贴脸苦力怕) 时, ModeController 合法地不调它的 update, mobAge 涨到 1~2 分钟是正常的。
//    所以分两档: 崩溃 = catch 路径写的 '?' 状态 (精确); 饿死 = 5 分钟都没被排程 (本身就不正常, T-0122 类)。
export const MOBILITY_STALE_SEC = 300;
export const mobilityCrashed = (s) => /^\?/.test(s.mobRaw || '');
export const mobilityStaleActive = (s) => !!s.v && s.ageS < 60
    && (mobilityCrashed(s) || (Number.isFinite(s.mobAge) && s.mobAge > MOBILITY_STALE_SEC));
// ── BOOTSTRAP resource-floor deadlock (T-0012): 0 usable picks AND no pickaxe in the bag (a table does NOT clear it). ──
export const bootstrapDeadlockActive = (s) => s.picks === 0 && !s.has(/_pickaxe$/);
// ── FALSE-SHELTER (T-0040/T-0085): the SILENT night near-miss — sheltering intent but roof NOT sealed. ──
export const falseShelterActive = (s) => !!(s.wm && s.wm.time && s.wm.time.isDay === false
    && s.wm.cover && s.wm.cover.coverReal === false
    && (/prepNether|shelter|bunker|sleep|bed/i.test(s.skill || '') || /POCKET|ENC|ENTOMB|MAROON/i.test(s.mob || ''))
    && (s._stale ? s._stale.staleMs >= 60000 : false)
    && (s.threat ? (s.threat.actionable | 0) === 0 : true));
