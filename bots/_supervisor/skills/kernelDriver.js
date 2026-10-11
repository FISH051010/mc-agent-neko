// Hot-reloadable TOP-LEVEL EXECUTOR (framework-v2 Stage0). kernelDriver is the new
// sticky skill that becomes the SINGLE dispatch source — it holds the ws_server
// _skillRunning lock and is the only thing that fires child skills. It does NOT
// decide anything: the decision layer (modes.js proposeTasks + world_model
// commitGoal, run every 2s with NO LLM and NO kernel) writes bot._commitment =
// { kind, skill, args, since }, and this driver just translates that commitment
// into a customSkill child dispatch.
//
//   state                                       → action
//   supervisor cancel / interrupt               → reset + return (release the lock)
//   in the nether                               → hold near portal, light netherrack mining
//   obsidian>=10 + flint_and_steel              → realNetherPortal (build + light + walk in)
//   reflex busy (ENTOMBED/POCKET/.../threat)    → short wait, let the instinct layer act first
//   bot._commitment.skill changed               → customSkill(skill, ...args)
//   otherwise                                   → wait, re-poll the commitment
//
// SAFETY: this NEVER re-implements survival reflexes (those live in modes.js instinct
// and run untouched), and it NEVER deletes missionNether (kept as a rollback anchor).
// kernel stays observe-only; nothing here ever calls the LLM.
//
// Invoked via: {"skill":"kernelDriver","args":[]}
// ctx = { skills, world, mc, Vec3, log }
import fs from 'fs';
import path from 'path';
import { reflexGateRefusals } from '../../../src/agent/framework/reflex_body_gate.js';   // ★T-0241
const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] [kernel] ${s}\n`); } catch (e) {} };

// Reflex-busy gate: if the ① instinct layer (modes.js) is mid-rescue — a mobility
// trap (ENTOMBED/POCKET/MAROONED/SEALED/SWIM) or an actionable threat — DON'T dispatch
// a strategic child on top of it. Yield with a short
// wait so self_preservation / mobility / self_defense can run first, then re-poll.
// ★T-0101/T-0083 FROZEN-ALIVE 互锁破除 (worker-frozen): food 见底(<=2)
//   且无现实急症(贴脸 creeper<4.5 / 正在挨打 / swarm 围殴贴脸)时,
//   food hold 是死锁不是避险,reflexBusy 必须让位给决策层派 GET_FOOD/villageHarvest 去觅食。
//   与 world_model.js isFamineStall(w) 同口径(决策层那端已破 HOLD@95 与 villageClose 否决)。
export function famineStall(bot) {
    try {
        const w = bot._world; if (!w) return false;
        const t = w.threat || {}, v = w.vitals || {};
        const creeperLethal = Number.isFinite(t.creeperDist) && t.creeperDist < 4.5;
        const swarmPin = (t.actionable || 0) >= 2;   // 用 actionable(可达威胁)非 raw closest(墙外够不到的怪不算 LETHAL)
        const lethal = creeperLethal || !!t.takingDamage || swarmPin;
        const food = (v.food != null) ? v.food : (bot.food != null ? bot.food : 20);
        return !lethal && food <= 2 && !v.canRegen;
    } catch (e) { return false; }
}
const WORLD_FRESH_MS = 8000;   // world_model rewrites bot._world every ~2s
function freshWorldSaysFree(bot, now = Date.now()) {
    const w = bot && bot._world;
    return !!(w && Number.isFinite(w.ts) && now - w.ts <= WORLD_FRESH_MS && w.mobility && w.mobility.state === 'FREE');
}
function hasPickaxe(bot) {
    try { return bot.inventory.items().some(i => /_pickaxe$/.test(i.name || '')); } catch (e) { return false; }
}
// mobility 救援态 — kernelDriver 见之让位; arbiter.dispatchYieldFloor 认让位戳 (T-0080 契约两端同口径)
export const MOBILITY_YIELD_RE = /ENTOMBED|POCKET|MAROONED|SEALED|SWIM/;
export function reflexBusy(bot) {
    try {
        // ★饥饿觅食解锁: 纯饥饿僵局(非 LETHAL)时,绝不让 reflex 门把觅食派发卡死。决策层此刻
        //   committed 到 GET_FOOD/OPENING_VILLAGE(去 village@近 收割/觅食),必须放行去执行,否则
        //   bot 在封箱里饿死(9h 实锤)。觅食 skill 自带 hostileNear/hp gate,不会无脑冲怪堆。
        //   注意 POCKET 等 mobility 门也放行——封箱(enclosed)常被建模为 POCKET,但那不是真被卡死
        //   的窄缝(coverReal 安全),让位只会空等;觅食派发会带 bot 走出去(走出后 POCKET 自然解除)。
        if (famineStall(bot)) return false;
        const m = bot._mobility && bot._mobility.state;
        // ★T-0086 竖井底 POCKET 互等: POCKET = 无水平出口、头顶开、被覆盖 — 正是 mineDown 自挖 1x1 竖井
        //   的常态。有镐的 bot 在石头里不是被困(挖哪都通), 让位只换来 mobility 的 30s 等待 + step-up 把
        //   bot 抬高 1 格撤销下挖 (live 10-10 00:40/42/44/47 四连, 每次 mineDown 返回后空等 ~30s)。
        //   有镐时直接派发 commitment(挖掘/寻路自会挖穿); 无镐的 POCKET 才是真窄缝, 照旧让位给垫/挖反射。
        if (m === 'POCKET' && hasPickaxe(bot)) return false;
        // ★T-0194 同理 SEALED (live 10-10 00:16:52→00:17:58+: 白天地下夜坑里 SEALED 脱困期, kernel 让位零任务, mobility
        //   在 y34 实心岩层横挖 23 格+ — 地下没有"外面"可通, 可挖满 5min 上限)。有镐 = 任务自己挖就是出路; 任务一挖,
        //   T-0163 的 working 门即结束脱困期。无镐的 SEALED 才是真困, 照旧让位给脱困反射。
        if (m === 'SEALED' && hasPickaxe(bot)) return false;
        // ★T-0122 陈旧 mobility: bot._mobility 只在 mobility mode 的 update 里刷新 — 它被自己挂死的 burst
        //   锁住、或被排在前面的 self_preservation 长 hold 饿死时, 会停在 ENTOMBED/POCKET 不动 (live 10-10
        //   00:59→01:03 白天 4.5min、01:09→ 夜里 5min+: vitals mob=ENTOMBED 而 world_model 自算 FREE, kernelDriver
        //   零派发)。world_model 是 always-on 观察者, 每 2s 用同一几何判据自算 mobility — 它新鲜且说有可走
        //   出口(FREE)时, ENTOMBED/POCKET 这两个纯几何的说法已被物理推翻, 不再让位。SEALED/MAROONED/SWIM*
        //   依赖 flood-fill/历史, 世界模型算不出, 照旧信任 mobility。
        if ((m === 'ENTOMBED' || m === 'POCKET') && freshWorldSaysFree(bot)) return false;
        if (m && MOBILITY_YIELD_RE.test(String(m))) return true;
        // ★FROZEN-ALIVE FIX (live -24,50,-31 pin ~6min): the passive `enclosed` flag (a ceiling
        // overhead) is NOT a reason to defer — a bot mining/sheltering underground is "enclosed"
        // BY DEFINITION. When mobility has already released to FREE (state not a rescue state)
        // but enclosed is still set, deferring here = deadlock: mobility thinks it's FREE (won't
        // act), kernelDriver yields forever (won't dispatch), bot stands frozen while botwatch
        // STUCK-ZONE-cancels every 5min to no effect. Only the ACTIVE rescue STATES above warrant
        // yielding; once they clear, the strategic layer MUST dispatch (mine/surface out). So the
        // standalone enclosed check is removed.
        const w = bot._world;
        if (w && w.threat && w.threat.actionable) return actionableYieldHeld(bot);
        bot._actionableIdleSince = 0;
    } catch (e) {}
    return false;
}

// ★T-0182 #34 (让位必须有人接): actionable 威胁让位的前提是反射真在接 —— 接收方 (self_defense/self_preservation)
//   各有自己的触发判据 (无武器豁免 / 不挨打不逃 / creeper hold 结束…), 与 world_model 的 actionable 口径不一。
//   反射持身 (bot._bodyOwner.kind==='mode') → 照让; 连续 ACTIONABLE_YIELD_MS 无任何反射持身 → 恢复派发
//   (子技能自带 hostile 门, 如 quickMeal "scout paused"; 挨打后 C376 兜底照常)。
/** 承诺翻转中断 (全局 interrupt_code) 只在没有反射 mode 持身时发 — 否则它同时杀掉反射 (defendSelf 见旗即退)。 */
export function flipInterruptAllowed(bot) {
    return !(bot && bot._bodyOwner && bot._bodyOwner.kind === 'mode');
}
export const ACTIONABLE_YIELD_MS = 8000;
export function actionableYieldHeld(bot, now = Date.now()) {
    const reflexHolding = !!(bot._bodyOwner && bot._bodyOwner.kind === 'mode');
    if (reflexHolding) { bot._actionableIdleSince = 0; return true; }
    if (!bot._actionableIdleSince) bot._actionableIdleSince = now;
    return now - bot._actionableIdleSince < ACTIONABLE_YIELD_MS;
}


// ★NO-OP-SPIN ESCAPE criteria (T-0110), pure — pinned by test/kernel_driver.test.mjs.
// Genuine progress = a >8b HORIZONTAL hop, real DESCENT (>4b down toward iron), or an ORE/log gain.
export function noopIsProgress(anchor, anchorSig, p, sig) {
    const horiz = Math.hypot(p.x - anchor.x, p.z - anchor.z);
    const descended = (anchor.y - p.y) > 4;   // net drop toward iron = real progress
    return horiz > 8 || descended || sig > anchorSig;
}
// Which escape (if any) a churned-out no-op spin may take: 'migrate' (day) / 'nightShelter' (night),
// or null when blocked (legit sealed night hold / active combat / deep mining).
// ★T-0105 (10-10 16:15:48 黎明死: NIGHT_DIG_ONE 封坑 hold 524s 被判 no-op → tod≈23100 world_model 已转
// isDay → legitNightHold 失效 → force migrate 拉出口袋 → 云杉荫下骷髅未晒死 → shot:Skeleton, 掉光装备)。
// 夜间/hold 类承诺"站着不动"就是它的成功态 (kernel.js NO_DELTA_EXEMPT 同一判据) — 绝不当空转逃逸;
// 天亮后决策层换承诺 → noopSkill 变化 → 锚点自然重置。
// ★T-0069: FOOD_FLOOR 自带移动 (上浮/背离敌对侦察/贴近猎杀); 因敌对 deferred 时原地等是对的 — hp=1 被强制 migrate 才是送死。
export const NOOP_EXEMPT_KIND = /^(NIGHT_|DUSK_GO_BED$|HOLD$|SLEEP$|FREE_PLAY$|FOOD_FLOOR$)/;
export function noopEscapePlan(w, kind) {
    w = w || {};
    if (kind && NOOP_EXEMPT_KIND.test(String(kind))) return null;
    const isDay = !(w.time && w.time.isDay === false);
    const legitNightHold = !isDay && w.cover && w.cover.coverReal === true && (!w.threat || (w.threat.actionable || 0) === 0);
    const inCombat = w.threat && ((w.threat.actionable || 0) > 0 || w.threat.takingDamage === true);
    // ★DEPTH GATE (T-0110 refine — live death: escape fired on a barren branchMine
    // @y18 → migrate marched UP through terrain → SUFFOCATION @y52 + lost the shaft +
    // respawned at spawn). At mid/deep the bot is actively mining; a barren branchMine
    // stretch is NORMAL and migrate would path dangerously upward. Down here mineDown
    // owns relocation (branchMine stallRounds → returns → GO_UNDERGROUND re-dispatches a
    // fresh branch). Only escape at/near the surface, where a true no-op-pin (coastal
    // prepNether / mineDown-can't-descend) needs a horizontal migrate.
    const db = w.pos && w.pos.depthBand;
    const deepMining = db === 'mid' || db === 'deep';
    if (!legitNightHold && !inCombat && !deepMining) return isDay ? 'migrate' : 'nightShelter';
    return null;
}

// ★T-0115 DISPATCH-FAILURE COOLDOWN for the LIVE dispatcher. The 3-strike → 5-min kind cooldown
// (bot._kindCooldownUntil, filtered by world_model.proposeTasks) was only ever stamped by
// framework/kernel.js _settleDispatch — but kernelDriver is the dispatcher actually running, and it
// discarded every child's return value. So a skill honestly returning {failed:true} ("NO-OP ... failed
// for kernel cooldown") got re-dispatched every 1.5s forever (live 10-10: GET_BED→prepNether no-op;
// progress history: ★dispatch-cooldown 0×, prepNether NO-OP 2474×), leaving only the 90s NO-OP-SPIN
// escape that marches the bot away. Same contract as kernel.js: strict false / {ok:false} /
// {failed:true} / threw = failure; a supervisor-cancel or interrupt unwind is NOT a strike (neither
// strike nor reset); success resets the kind's streak. Streaks live on the bot (survive hot-reload).
export const DISPATCH_FAIL_LIMIT = 3;
export const DISPATCH_COOLDOWN_MS = 300000;
export const FLIP_FORCE_HALT_MS = 2000;   // ★T-0206 承诺翻转后子任务 2s 不退 → 强制交出身体
const SUPERVISOR_CANCEL_WINDOW_MS = 30000;
export function isDispatchFailure(res, threw) {
    return !!threw || res === false || !!(res && typeof res === 'object' && (res.ok === false || res.failed === true));
}
// ★T-0241 (live 10-11 02:25-02:27Z): self_preservation held the body in bursts, the T-0231 gate refused mineDown's walk/path,
//   relocate failed → 3 "failures" → DUSK_MINE_NIGHT cooled. A child whose body a reflex borrowed did not fail at its job:
//   no strike (streak kept). Bounded (监工): ≥GATE_DEFER_LIMIT such defers of one kind in GATE_DEFER_WINDOW_MS (a reflex
//   holding the body all night) → failures strike again, so it can't become a strike-free re-dispatch spin.
export const GATE_DEFER_LIMIT = 6;
export const GATE_DEFER_WINDOW_MS = 600000;
export function settleDispatch(bot, kind, res, { threw = false, interrupted = false, gateRefused = false, now = Date.now() } = {}) {
    if (!bot || !kind) return { failed: false, cooled: false, strikes: 0 };
    const fails = bot._kdDispatchFails || (bot._kdDispatchFails = {});
    if (!isDispatchFailure(res, threw)) { fails[kind] = 0; return { failed: false, cooled: false, strikes: 0 }; }
    const cancelUnwind = !!bot._supervisorCancelAt && now - bot._supervisorCancelAt < SUPERVISOR_CANCEL_WINDOW_MS;
    if (cancelUnwind || interrupted) return { failed: true, cooled: false, strikes: fails[kind] || 0, unwind: true };
    if (gateRefused) {
        const gd = bot._kdGateDefers || (bot._kdGateDefers = {});
        gd[kind] = (gd[kind] || []).filter(at => now - at < GATE_DEFER_WINDOW_MS);
        if (gd[kind].length < GATE_DEFER_LIMIT) {
            gd[kind].push(now);
            return { failed: true, cooled: false, strikes: fails[kind] || 0, deferred: true, gateDefers: gd[kind].length };
        }
    }
    fails[kind] = (fails[kind] || 0) + 1;
    if (fails[kind] < DISPATCH_FAIL_LIMIT) return { failed: true, cooled: false, strikes: fails[kind] };
    fails[kind] = 0;
    const cd = bot._kindCooldownUntil || (bot._kindCooldownUntil = {});
    cd[kind] = now + DISPATCH_COOLDOWN_MS;
    if (bot._commitment && bot._commitment.kind === kind) bot._commitment = null;
    return { failed: true, cooled: true, strikes: DISPATCH_FAIL_LIMIT };
}

// ★2026-10-10 HOT-SPIN 根治: 派发器的节奏等待曾用 skills.wait —— 它在 bot.interrupt_code 为真时**立即返回**。
//   interrupt_code 是给子 skill 的停车信号; 一旦它在派发器循环里粘住 (16:04:00 热部署 cancel 交接实录),
//   子 skill 见之秒退、"防热转" wait(1500) 也秒退 → 1.3s 跑满 5000 次上限 (5000 行 dispatch, 零次真执行),
//   07-16 两次 "loop exhausted" 同一机理。派发器的等待必须真等: 只认 supervisor cancel 提前醒 (热部署握手
//   要在 30s 窗内被看到), 不认 interrupt_code。
const SUPERVISOR_CANCEL_WAKE_MS = 30000;
export async function pace(bot, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (bot && bot._supervisorCancelAt && Date.now() - bot._supervisorCancelAt < SUPERVISOR_CANCEL_WAKE_MS) return false;
        await new Promise((r) => setTimeout(r, Math.min(250, Math.max(1, end - Date.now()))));
    }
    return true;
}

export default async function kernelDriver(bot, ctx) {
    const { skills, world } = ctx;
    const has = (n) => { try { return world.getInventoryCounts(bot)[n] || 0; } catch (e) { return 0; } };
    // 非 skills.wait: 见上方 pace() 注释 (interrupt 粘住 → 热转)。ctx.pace = 测试接缝 (假时钟快进)。
    const wait = (ms) => (ctx.pace ? ctx.pace(bot, ms) : pace(bot, ms));
    const inNether = () => { try { return /nether/.test(bot.game.dimension); } catch (e) { return false; } };

    // reflexBusy / famineStall live at module scope (pure; pinned by test/kernel_driver.test.mjs)

    prog('==== kernelDriver START (sticky executor — sole dispatch source) ====');
    let lastSkill = null;
    // ★task-queue Phase C: bot._commitment carries a stable .id (the queue HEAD task id) when
    //   commitQueue runs LIVE (taskqLive). A second dispatch trigger on c.id catches a HEAD swap to a
    //   DIFFERENT task that happens to reuse the SAME skill (two ore veins, two nightShelter modes) —
    //   skill alone wouldn't change so kernelDriver would miss it. In Phase A/B commitGoal writes no
    //   .id (undefined) → these checks are inert (undefined===undefined), fully backward-compatible.
    let lastId = null;
    // ★NO-OP-SPIN ESCAPE state (worker-frozen 0701, T-0110). kernelDriver has no progress check —
    // a committed skill that returns fast doing NOTHING (prepNether no-op when wood unreachable /
    // no wool for GET_BED; mineDown abort near water) is re-dispatched every 1.5s forever = frozen-
    // alive (live 45min @88,66 coastal, oscillating BOOTSTRAP_KIT↔GET_BED, both prepNether no-ops).
    // We anchor pos+inv when a skill first commits and, if the SAME skill churns 90s+ with <8b net
    // move AND no inventory gain AND it's not a legit night-hold / active combat, force ONE migrate
    // (day) / nightShelter-seal (night) to escape the bad spot. Cooldown-gated against thrash. This
    // catches the whole CLASS of no-op spins (any skill), unlike a per-proposal decision-layer fix.
    let noopSkill = null, noopAnchor = null, noopAnchorAt = 0, noopAnchorSig = 0, noopLastEscapeAt = 0;
    // Progress signal = ONLY goal-relevant resources (ore / metal / logs / gems) — NOT dirt/cobble/
    // sand/gravel, which a stuck mineDown scrapes up while churning in place (live: held=dirt, inv
    // 24k→27k creeping, yet ZERO net descent or iron). A total-count sig would false-re-anchor on
    // that junk and the escape would never fire. Re-anchor also on real DESCENT or a >8b horizontal
    // hop (both are genuine progress); digging junk sideways at a bad spot is none of these.
    const noopOreSig = () => { try { const inv = world.getInventoryCounts(bot) || {}; let s = (inv.raw_iron || 0) * 10 + (inv.iron_ore || 0) * 10 + (inv.iron_ingot || 0) * 10 + (inv.diamond || 0) * 30 + (inv.coal || 0) * 2 + (inv.raw_copper || 0) * 2 + (inv.raw_gold || 0) * 5 + (inv.redstone || 0) + (inv.lapis_lazuli || 0); for (const k in inv) if (/_log$/.test(k)) s += (inv[k] || 0) * 4; return s; } catch (e) { return 0; } };
    for (let iter = 0; iter < 5000; iter++) {
        // ★STAGE-GATE HEARTBEAT: stamp that kernelDriver is the LIVE dispatcher. legacy night/dispatch
        // owners (prepNether.nightOwnedByDecisionLayer) check this fresh stamp to decide whether to yield —
        // so they ONLY yield once the cutover is real (kernelDriver actually running as sticky), not the
        // instant bot._world.nightPlan merely exists (true in Stage-0 shadow, before cutover).
        bot._kernelDriverActive = Date.now();
        // ① cancel handshake — release the run_skill lock the moment the supervisor
        //    cancels or an interrupt is posted (mirrors missionNether 353-358).
        if (bot._supervisorCancelAt && Date.now() - bot._supervisorCancelAt < 30000) {
            prog('supervisor cancel received — returning to release run_skill lock');
            try { bot.interrupt_code = false; bot._supervisorCancelAt = 0; } catch (e) {}
            return { cancelled: true };
        }
        if (bot.interrupt_code) { try { bot.interrupt_code = false; } catch (e) {} await wait(2500); }

        // ② in the nether — WIN STATE. Hold near the portal; mine a little netherrack on
        //    a slow cadence so the watchdog's pos+inv STUCK detector stays fed (mirrors
        //    missionNether 1021-1036). Don't wander (ghasts/piglins).
        if (inNether()) {
            try {
                const rack = await world.getNearestBlockAsync(bot, 'netherrack', 6);
                if (rack && has('netherrack') < 64) await skills.collectBlock(bot, 'netherrack', 1);
            } catch (e) {}
            await wait(20000);
            continue;
        }

        // ③ kitted for a portal — build + light + walk through (mirrors missionNether
        //    1039-1055). The dedicated realNetherPortal child handles the rest.
        if (has('obsidian') >= 10 && has('flint_and_steel') >= 1) {
            prog(`kitted (obsidian=${has('obsidian')} f&s=${has('flint_and_steel')}) → realNetherPortal`);
            let r = null;
            try { r = await skills.customSkill(bot, 'realNetherPortal'); }
            catch (e) { prog(`realNetherPortal threw: ${e.message}`); }
            if (r && r.entered) { lastSkill = null; continue; }   // next iter detects nether
            await wait(8000);
            lastSkill = null;
            continue;
        }

        // ④ read the commitment the decision layer wrote (modes.js every 2s; now carries
        //    args). Empty → nothing committed yet, wait and re-poll.
        const c = bot._commitment;
        if (!c || !c.skill) { await wait(1500); continue; }

        // Defer to the reflex layer if it's mid-rescue — short wait so ① runs first.
        if (reflexBusy(bot)) {
            // ★T-0080 让位戳: 告诉仲裁器"派发器正在为 mobility 让位"— 否则 mode:mobility 抢身体时
            //   holder=ws:*(就是这里在空等)被 LLM 超时回退判胜, 双方互等 = 3min 零动作死锁。
            //   arbiter.dispatchYieldFloor 认这个戳 (3s 新鲜窗; 这里每 ~0.8s 重打)。
            try {
                const m = String((bot._mobility && bot._mobility.state) || '');
                if (MOBILITY_YIELD_RE.test(m)) bot._dispatchYield = { reason: 'mobility', state: m, at: Date.now() };
            } catch (e) {}
            await wait(800); continue;
        }

        // Dispatch only on a skill change (avoid stomping a still-running child). The
        // commitment's args are forwarded positionally, matching customSkill's
        // (bot, ctx, ...args) child signature — nightShelter needs args like 'dig_one'
        // / 'seal', mineDown needs { targetY: 12 }.
        if (c.skill !== lastSkill || (c.id != null && c.id !== lastId)) {
            lastSkill = c.skill;
            lastId = (c.id != null) ? c.id : null;
            const args = Array.isArray(c.args) ? c.args : (c.args != null ? [c.args] : []);
            const startKind = c.kind;
            const startId = (c.id != null) ? c.id : null;
            prog(`dispatch → ${c.skill} (kind=${c.kind || '?'}${c.id ? ' id=' + c.id : ''}) args=${JSON.stringify(args)}`);
            // ★T-0081 INTERRUPT PATH (was entirely missing): while the child runs, watch the
            // commitment the decision layer keeps re-writing. If it FLIPS to a different kind — a
            // dusk/night plan dethroning a stale daytime task (migrate blocking through dusk), or
            // an emergency HOLD — raise interrupt_code so the child (migrate/mineDown/… all honor
            // it) bails promptly and we re-dispatch the NEW goal, instead of blocking to completion
            // and running the wrong task into the night. The loop-top consumes the interrupt.
            let flipped = false, firstFlipAt = 0, forcedHalt = false;
            const _watch = setInterval(() => {
                try {
                    const nc = bot._commitment;
                    if (!nc) return;
                    const kindFlip = nc.kind && nc.kind !== startKind;
                    const idFlip = (nc.id != null && startId != null && nc.id !== startId);   // Phase C: head swapped (maybe same skill)
                    if (kindFlip || idFlip) {
                        // ★T-0206 death #16 战斗部分: interrupt_code 是全局旗 — self_defense 的 defendSelf 每 500ms 见旗即 pvp.stop()
                        //   退出。01:43:19–41 commitment 每秒翻转 → 每秒打断接战 (T-0199 探针 PVP.stop×9)。反射持身时推迟,
                        //   反射放手后下一秒再中断子技能 (子技能此刻也没在动身体)。
                        if (!flipInterruptAllowed(bot)) {
                            if (Date.now() - (bot._flipDeferLogAt || 0) > 5000) {
                                bot._flipDeferLogAt = Date.now();
                                prog(`commitment flipped ${startKind || '?'}→${nc.kind} — interrupt deferred: reflex ${bot._bodyOwner.name} holds the body (T-0206)`);
                            }
                            return;
                        }
                        if (!firstFlipAt) firstFlipAt = Date.now();
                        // ★T-0206 (death #16 01:43:33-41Z: 翻转后 bedErrand 8 秒不退, 位置钉死 act/ctrl 皆空, 僵尸贴身):
                        //   子任务 2s 内不退 → 强制停寻路 + 松开按键交出身体 (setGoal(null) 立即生效, 不用 stop() 的延迟标志),
                        //   让反射/新承诺立刻能驾驶; 不再干等子任务自己理会 interrupt_code。只做一次。
                        //   反射持身时上面 flipInterruptAllowed 已 return (不打断也不接管, 监工协调: 否则 defendSelf 见旗即 pvp.stop); 计时从首次允许打断起。
                        if (!forcedHalt && flipped && Date.now() - firstFlipAt >= FLIP_FORCE_HALT_MS) {
                            forcedHalt = true;
                            try { bot.pathfinder && bot.pathfinder.setGoal(null); } catch (e) {}
                            try { bot.clearControlStates(); } catch (e) {}
                            prog(`child ${c.skill} ignored interrupt ${Math.round((Date.now() - firstFlipAt) / 1000)}s after flip → force halt (setGoal(null)+clearControlStates), body released (T-0206)`);
                        }
                        flipped = true;
                        prog(`commitment flipped ${startKind || '?'}${startId ? '/' + startId : ''}→${nc.kind}${nc.id ? '/' + nc.id : ''} mid-child → interrupt ${c.skill} to re-dispatch`);
                        bot._commitFlipAt = Date.now();   // ★T-0181: tells interrupt-shielding children (surfaceUp) this is the caller, not a reflex
                        bot.interrupt_code = true;
                    }
                } catch (e) {}
            }, 1000);
            let childRes, childThrew = false;
            const _gateBefore = reflexGateRefusals(bot);   // ★T-0241
            try {
                childRes = await skills.customSkill(bot, c.skill, ...args);
            } catch (e) {
                childThrew = true;
                prog(`child ${c.skill} threw: ${e.message}`);
            } finally {
                clearInterval(_watch);
            }
            // ★T-0115: honor the child's verdict — 3 consecutive failures of this kind → 5-min cooldown + release.
            try {
                const st = settleDispatch(bot, startKind, childRes, { threw: childThrew, interrupted: flipped || !!bot.interrupt_code, gateRefused: reflexGateRefusals(bot) > _gateBefore });
                if (st.deferred) prog(`${c.skill} failed while a reflex held the body (gate refused ${reflexGateRefusals(bot) - _gateBefore}×) — deferred, no strike (${st.gateDefers}/${GATE_DEFER_LIMIT} in ${GATE_DEFER_WINDOW_MS / 60000}min, T-0241)`);
                if (st.cooled) prog(`★dispatch-cooldown ${startKind} via ${c.skill}: failed ${DISPATCH_FAIL_LIMIT}x consecutively — suppressing ${startKind} proposals ${DISPATCH_COOLDOWN_MS / 60000}min + releasing commitment`);
            } catch (e) {}
            // Child returned (done / cancelled / errored) — reset so the same commitment
            // re-dispatches on the next loop, and a changed commitment dispatches fresh.
            lastSkill = null;
            lastId = null;
            // ★NO-OP-SPIN ESCAPE (T-0110): compare this dispatch's outcome to the anchor. Genuine
            // progress — a >8b HORIZONTAL hop, real DESCENT (>4b down toward iron), or an ORE/log
            // gain — re-anchors; a churning no-op (junk-only inv creep, no descent, no relocation)
            // accumulates toward the escape.
            try {
                const p = bot.entity && bot.entity.position;
                if (p) {
                    const sig = noopOreSig();
                    if (noopSkill !== c.skill || !noopAnchor) {
                        noopSkill = c.skill; noopAnchor = { x: p.x, y: p.y, z: p.z }; noopAnchorAt = Date.now(); noopAnchorSig = sig;
                    } else {
                        if (noopIsProgress(noopAnchor, noopAnchorSig, p, sig)) {
                            noopAnchor = { x: p.x, y: p.y, z: p.z }; noopAnchorAt = Date.now(); noopAnchorSig = sig;
                        } else if (Date.now() - noopAnchorAt > 90000 && Date.now() - noopLastEscapeAt > 120000) {
                            const w = bot._world || {};
                            const escape = noopEscapePlan(w, c.kind);
                            const isDay = escape === 'migrate';
                            if (escape) {
                                prog(`★NO-OP-SPIN escape: ${c.skill} churned ${Math.round((Date.now() - noopAnchorAt) / 1000)}s (no >8b hop / no descent / no ore) @${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)} → force ${isDay ? 'migrate(escape bad spot)' : 'nightShelter seal'}`);
                                noopLastEscapeAt = Date.now();
                                noopSkill = null; noopAnchor = null;
                                try {
                                    if (isDay) await skills.customSkill(bot, 'migrate', { force: true, maxBlocks: 128, cooldownMin: 0, settleScore: 6 });
                                    else await skills.customSkill(bot, 'nightShelter', 'seal');
                                } catch (e) { prog(`NO-OP-SPIN escape skill threw: ${e.message}`); }
                                await wait(1500);
                                continue;
                            }
                        }
                    }
                }
            } catch (e) {}
            // ★ANTI-HOT-SPIN (live 18:17:30: nightShelter('seal') returns true INSTANTLY when the
            // roof is already covered → this loop re-dispatched it every ~2ms and burned the whole
            // 5000-iter cap in seconds → 'loop exhausted' → bridge respawn churn). Throttle the
            // re-dispatch: for a fast-returning hold (sealed bunker) this paces the re-check to ~1.5s
            // AND keeps the loop-top heartbeat fresh (so prepNether stays yielded); for a long
            // continuous child (a full mineDown shaft) the 1.5s is negligible overhead.
            await wait(1500);
        } else {
            await wait(1500);
        }
    }
    prog('kernelDriver loop exhausted (5000 iters) — returning');
    return { exhausted: true };
}
