// ★T-0231 身体所有权缺口 (death #22 04:51:13: ctrl `forward,back,right,sneak,sprint` + path=1 — branchMine 的寻路与 sprintFlee
// 同时驱动身体)。ws 派发的受监督技能 (kernelDriver→子技能) 不跑在 ActionManager 里, 反射 mode 经 execute() 接管时
// actions.stop() 根本停不到它; 仲裁器判了"谁赢", 输家照样 setGoal / 按键。sprintFlee 入口还会吞掉全局 interrupt_code。
// 让位必须以接收方此刻独占为前提: 反射持身 (bot._bodyOwner.kind==='mode') 期间, 【来自技能调用链】的寻路目标/移动键一律拒绝。
// 归属用 AsyncLocalStorage 标【技能】链 (skills.customSkill 在 skillCtx.run 里执行) —— 不能反过来标反射链: pathfinder /
// mineflayer-pvp 在 physicsTick 事件里调 setGoal/setControlState, 那些调用不带任何链标记, 必须放行 (反射的寻路/PVP 靠它们)。
import { AsyncLocalStorage } from 'node:async_hooks';

export const skillCtx = new AsyncLocalStorage();
export const inSkill = () => !!skillCtx.getStore();
// 反射链标记: execute() 在 reflexCtx 里跑 mode 函数。反射自己调的 customSkill (self_defense→shieldFight 等) 不进 skillCtx。
export const reflexCtx = new AsyncLocalStorage();
export const inReflex = () => !!reflexCtx.getStore();
/** customSkill 用: 反射链里调用 → 原样执行; 否则在技能链里执行 (受闸)。 */
export function runAsSkill(name, fn) {
    if (inReflex()) return fn();
    return skillCtx.run({ skill: name }, fn);
}
// ★T-0239: always-on reflexes (edge_unstick back-off) never go through execute() → no _bodyOwner. A short timed hold lets
//   them own the body for a few hundred ms of raw keys, so the skill's next-leg setGoal cannot override the sidestep at once.
export function holdBodyForReflex(bot, name, ms, now = Date.now()) {
    if (bot) bot._reflexHold = { name: `reflex:${name}`, until: now + ms };
}
export const reflexHolds = (bot, now = Date.now()) => !!(bot && ((bot._bodyOwner && bot._bodyOwner.kind === 'mode')
    || (bot._reflexHold && bot._reflexHold.until > now)));
/** ★T-0241 monotonic count of skill-chain calls the gate refused on this bot (snapshot before/after a dispatch). */
export const reflexGateRefusals = (bot) => (bot && bot._reflexGateBlocks) || 0;
export const holderName = (bot) => (bot && bot._bodyOwner && bot._bodyOwner.kind === 'mode' && bot._bodyOwner.name)
    || (bot && bot._reflexHold && bot._reflexHold.name) || '?';

/** 包 bot.pathfinder.setGoal / bot.setControlState / bot.clearControlStates (幂等)。onBlock(kind, detail) 可选, 用于限频日志。 */
export function installReflexBodyGate(bot, { onBlock } = {}) {
    if (!bot) return false;
    // per-part idempotent: initModes may run before the pathfinder plugin is loaded — execute() re-calls this cheaply.
    const parts = bot._reflexGateParts || (bot._reflexGateParts = {});
    if (onBlock) parts.onBlock = onBlock;
    // ★T-0241: count every refusal on the bot so the dispatcher can tell "the reflex borrowed the body" from a real failure
    const blocked = (kind, detail) => { bot._reflexGateBlocks = (bot._reflexGateBlocks || 0) + 1; try { if (parts.onBlock) parts.onBlock(kind, detail); } catch (e) {} };
    const gated = () => reflexHolds(bot) && inSkill();
    const pf = bot.pathfinder;
    if (!parts.pf && pf && typeof pf.setGoal === 'function') {
        parts.pf = true;
        const origSetGoal = pf.setGoal.bind(pf);
        pf.setGoal = (goal, dynamic) => {
            if (goal && gated()) {
                blocked('setGoal', goal && goal.constructor ? goal.constructor.name : '?');
                // throw (not no-op): pathfinder.goto() calls setGoal inside its promise executor — a no-op would hang it;
                // a throw rejects goto → the skill sees an ordinary path failure and backs off.
                throw new Error(`reflex holds the body (${holderName(bot)}) — skill pathing paused`);
            }
            return origSetGoal(goal, dynamic);
        };
    }
    if (!parts.set && typeof bot.setControlState === 'function') {
        parts.set = true;
        const origSet = bot.setControlState.bind(bot);
        bot.setControlState = (control, state) => {
            if (state && gated()) { blocked('setControlState', control); return; }
            return origSet(control, state);
        };
    }
    if (!parts.clear && typeof bot.clearControlStates === 'function') {
        parts.clear = true;
        const origClear = bot.clearControlStates.bind(bot);
        bot.clearControlStates = () => {
            if (gated()) { blocked('clearControlStates', ''); return; }   // a skill must not cancel the reflex's sprint
            return origClear();
        };
    }
    return !!(parts.pf && parts.set && parts.clear);
}
