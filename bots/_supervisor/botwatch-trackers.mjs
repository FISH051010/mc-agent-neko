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
// ★T-0166 (21:00): 分类已拆成 always-on 观察者(每 2s), 唯一合法空窗 = mobility 自身 burst(≤maxBurst 90s, 超了 T-0122
//   强制解锁)。故门槛从 300s 收紧到 120s: 超过它一定是真停摆, 不再是排程挤占。
export const MOBILITY_STALE_SEC = 120;
export const mobilityCrashed = (s) => /^\?/.test(s.mobRaw || '');
export const mobilityStaleActive = (s) => !!s.v && s.ageS < 60
    // ★T-0129b: 合法的封闭过夜(一夜≈7min)里 self_preservation 整夜占槽, mobility 合法地不被排程 → '饿死'档豁免;
    //   崩溃档('?')不豁免。用 legitNightHold 同一判据(夜+真遮蔽+无可行威胁+wm 新鲜), 与 FROZEN-ALIVE 口径一致。
    && (mobilityCrashed(s) || (Number.isFinite(s.mobAge) && s.mobAge > MOBILITY_STALE_SEC && !legitNightHold(s)));
// ── BOOTSTRAP resource-floor deadlock (T-0012): 0 usable picks AND no pickaxe in the bag (a table does NOT clear it). ──
export const bootstrapDeadlockActive = (s) => s.picks === 0 && !s.has(/_pickaxe$/);
// ── FALSE-SHELTER (T-0040/T-0085): the SILENT night near-miss — sheltering intent but roof NOT sealed. ──
export const falseShelterActive = (s) => !!(s.wm && s.wm.time && s.wm.time.isDay === false
    && s.wm.cover && s.wm.cover.coverReal === false
    && (/prepNether|shelter|bunker|sleep|bed/i.test(s.skill || '') || /POCKET|ENC|ENTOMB|MAROON/i.test(s.mob || ''))
    && (s._stale ? s._stale.staleMs >= 60000 : false)
    && (s.threat ? (s.threat.actionable | 0) === 0 : true));

// ── COOLDOWN-CHURN (2026-10-10, 监工): 同一 kind 60min 内被 dispatch-cooldown ≥3 次 = 提案端判可行而技能端判不可行,
//    两边判据不同源 (noop-dispatch 通律: 决策层绝不能 commit 技能层必拒的 skill)。7h 回放校准: 命中的恰是人工
//    才发现的三处 (GO_UNDERGROUND×5 mineDown 静默拒跑 / FOOD_FLOOR×4 地下侦察 / DUSK_MINE_NIGHT×3), 其余 kind ≤2。
export const COOLDOWN_CHURN_WINDOW_MS = 60 * 60000;
export const COOLDOWN_CHURN_THRESHOLD = 3;
const COOLDOWN_RE = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\].*★dispatch-cooldown (\w+)(?: via (\w+))?/;
export function makeCooldownChurnTracker({ windowMs = COOLDOWN_CHURN_WINDOW_MS, threshold = COOLDOWN_CHURN_THRESHOLD } = {}) {
    const ev = new Map();   // kind -> [{t, skill}]
    return {
        ingest(lines) {
            for (const line of lines) {
                const m = COOLDOWN_RE.exec(line);
                if (!m) continue;
                const t = Date.parse(m[1]);
                if (!Number.isFinite(t)) continue;
                if (!ev.has(m[2])) ev.set(m[2], []);
                ev.get(m[2]).push({ t, skill: m[3] || null });
            }
        },
        churning(now) {
            const out = [];
            for (const [kind, arr] of ev) {
                const recent = arr.filter((e) => now - e.t <= windowMs);
                ev.set(kind, recent);
                if (recent.length >= threshold) out.push({ kind, count: recent.length, skills: [...new Set(recent.map((e) => e.skill).filter(Boolean))] });
            }
            return out;
        },
    };
}

// ── IDLE-DISPATCH (2026-10-11, 监工): daytime with NO kernel dispatch for ≥3min while kernelDriver is the driver =
//    the decision layer committed nothing actionable (live 04:16:41→04:21:33: zero-pick REPLENISH_KIT on 5min cooldown,
//    every other proposal gated → 4m52s of standing still in daylight; root fixed by T-0259, this catches the class).
//    Activity = a '[kernel] dispatch →' line, OR a progress line from a SKILL (any tag not in the background set below —
//    reflex/framework chatter like [proposeTasks]/[mobility] keeps flowing while nothing is dispatched; unknown tags count
//    as activity, 宁缺毋滥), OR the body moving (>1 block between vitals samples — a long silent skill walking/digging).
//    Replay-calibrated on 10-09→10-11 progress+vitals: see test/idle_dispatch.test.mjs. Exempt: not day (world_model time.phase, same as the decision layer), kernelDriver
//    not running (cancelled / another sticky), and intentional stillness (last dispatched kind HOLD / HEAL, or a
//    self_preservation FAMINE body freeze).
export const IDLE_DISPATCH_MS = 3 * 60000;
const PROG_TS_RE = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\]\s*(.*)$/;
const DISPATCH_RE = /^\[kernel\] dispatch → (\w+) \(kind=(\w+)/;
const BACKGROUND_TAG_RE = /^\[(proposeTasks|mobility|kernel|body-gate|arbiter|edge_unstick|self_preservation|self_defense|unstuck|step-edge|arrow_guard|reflex_watchdog|swim|inv-sync|dig-gate|world-scope|motion_quality|threat_radar|auto_eat|cowardice|elbow_room|torch_placing|item_collecting)\]/;
const IDLE_EXEMPT_KINDS = new Set(['HOLD', 'HEAL']);
// reflex-side INTENTIONAL stillness (same nature as HOLD): self_preservation freezes the body on purpose (food=0/hp=1)
const INTENTIONAL_HOLD_RE = /^\[self_preservation\] FAMINE body freeze/;
export function makeIdleDispatchTracker({ idleMs = IDLE_DISPATCH_MS } = {}) {
    let lastActivityAt = null, lastKind = null, lastSkill = null, kernelRunning = true, dayStartedAt = null, lastPos = null;
    return {
        // vitals position each tick: moving > 1 block = the body is doing something (legit long skill / walking)
        noteBody(now, pos) {
            if (!pos || !Number.isFinite(pos.x)) return;
            if (lastPos && Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y, pos.z - lastPos.z) > 1) lastActivityAt = Math.max(lastActivityAt || 0, now);
            lastPos = { x: pos.x, y: pos.y, z: pos.z };
        },
        ingest(lines) {
            for (const line of lines) {
                const m = PROG_TS_RE.exec(line);
                if (!m) continue;
                const t = Date.parse(m[1]);
                if (!Number.isFinite(t)) continue;
                const body = m[2];
                const d = DISPATCH_RE.exec(body);
                if (d) { lastActivityAt = t; lastSkill = d[1]; lastKind = d[2]; kernelRunning = true; continue; }
                if (/^\[kernel\] ==== kernelDriver START/.test(body)) { kernelRunning = true; lastActivityAt = Math.max(lastActivityAt || 0, t); continue; }
                if (/^\[kernel\] (supervisor cancel received|kernelDriver loop exhausted)/.test(body)) { kernelRunning = false; continue; }
                if (INTENTIONAL_HOLD_RE.test(body)) { lastActivityAt = Math.max(lastActivityAt || 0, t); continue; }
                if (BACKGROUND_TAG_RE.test(body)) continue;
                lastActivityAt = Math.max(lastActivityAt || 0, t);   // a skill's own progress line
            }
        },
        // phase: world_model time.phase; driver: vitals skill (the sticky) — null/undefined = unknown (don't block)
        check(now, { phase, driver } = {}) {
            if (phase !== 'day') { dayStartedAt = null; return null; }
            if (dayStartedAt === null) dayStartedAt = now;
            if (!kernelRunning || (driver && driver !== 'kernelDriver')) return null;
            if (lastKind && IDLE_EXEMPT_KINDS.has(lastKind)) return null;
            const since = Math.max(lastActivityAt || 0, dayStartedAt);
            const idle = now - since;
            return idle >= idleMs ? { idleMs: idle, since, lastKind, lastSkill } : null;
        },
    };
}

// ── WATCHDOG KEEPER (T-0270): reverse keep-alive. watchdog.ps1 keeps botwatch alive; botwatch keeps the watchdog alive. ──
// 10-11 13:35 the watchdog was killed from outside (no EXIT line, siblings in the same job survived) and the stack stayed
// down 7 min until some session's SessionStart hook happened to run ensure-stack. Dead = BOTH signals: no watchdog.ps1
// process AND watchdog.log silent past staleS (heartbeat cadence ~130s). Relaunch goes through ensure-stack (idempotent,
// WMI launch outside any job) and the watchdog's own singleton mutex, throttled to one attempt per minGapMs.
export const WATCHDOG_STALE_S = 300;
export const WATCHDOG_REVIVE_GAP_MS = 5 * 60000;
const WD_TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/;
/** Last line + its timestamp (ms) from the tail of watchdog.log; ts null when no line carries one. */
export function watchdogLastBeat(logTail) {
    const lines = String(logTail || '').split(/\r?\n/).filter(l => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/botwatch keeper:/.test(lines[i])) continue;   // our own revive note is not a watchdog heartbeat
        const m = WD_TS_RE.exec(lines[i]);
        if (m) { const ts = Date.parse(m[1]); if (Number.isFinite(ts)) return { ts, line: lines[i], tail: lines.slice(-5) }; }
    }
    return { ts: null, line: null, tail: lines.slice(-5) };
}
/** procAlive: true/false/null(unknown); lastBeatMs from watchdogLastBeat. → 'ok' | 'hung' | 'revive' | 'throttled' */
export function makeWatchdogKeeper({ staleS = WATCHDOG_STALE_S, minGapMs = WATCHDOG_REVIVE_GAP_MS } = {}) {
    let lastReviveAt = -Infinity, failStreak = 0, pendingCheck = false;
    return {
        decide({ procAlive, lastBeatMs, now }) {
            const ageS = Number.isFinite(lastBeatMs) ? (now - lastBeatMs) / 1000 : Infinity;
            const beatFresh = ageS <= staleS;
            if (pendingCheck) {   // outcome of the previous revive: did a watchdog come back?
                pendingCheck = false;
                if (procAlive === true || beatFresh) failStreak = 0; else failStreak++;
            }
            if (beatFresh || procAlive === null) return { action: 'ok', ageS, failStreak };
            if (procAlive === true) return { action: 'hung', ageS, failStreak };   // process there but silent: mutex holder, don't double-launch
            if (now - lastReviveAt < minGapMs) return { action: 'throttled', ageS, failStreak };
            lastReviveAt = now; pendingCheck = true;
            return { action: 'revive', ageS, failStreak };
        },
    };
}
/** One ALERTS.txt line with the first-hand scene: last heartbeat time + the last log line before death. */
export function watchdogReviveAlert({ stamp, ageS, beat, failStreak = 0 }) {
    const last = beat && beat.line ? beat.line.slice(0, 200) : '(watchdog.log empty)';
    const at = beat && Number.isFinite(beat.ts) ? new Date(beat.ts).toISOString() : '?';
    const fails = failStreak > 0 ? ` (previous revive FAILED x${failStreak})` : '';
    return `[${stamp}] WATCHDOG DOWN → botwatch revive via ensure-stack${fails}: no watchdog.ps1 process, log silent ${Math.round(ageS)}s, last beat ${at} | last line: ${last}`;
}
