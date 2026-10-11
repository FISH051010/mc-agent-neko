import { purposefulDigActive } from './mobility_signals.js';
import { descentBlocked } from './food_floor.js';
import { hostileRawNear, DESCENT_HOSTILE_R } from './hostile_reach.js';

// ★T-0136 决策层夜挖 vs 反射预防性封箱 — 契约必须一致。
// 实录 10-10 18:47:23Z: 决策层 computeNightPlan 选 MINE_THROUGH_NIGHT → kernel 派 mineDown(DUSK_MINE_NIGHT);
// 同刻 bot 在 y59 (≥50 且 enclosed=false) → self_preservation.shouldNightShelter=true → bunkerDown "sealed night hold"
// 抢身体 → mineDown 每次 ~3.6s 秒退 → 3 连败 → DUSK_MINE_NIGHT 冷却 5min → FREE_PLAY 站着过夜 (零产出)。
// 下挖本身就是庇护 (地下即安全, 正是 shouldNightShelter 对 y<50 豁免的理由): 决策层已承诺夜挖 + 派发器在线 +
// 附近无怪 → 预防性封箱让位。反应式防御 (shouldFlee / creeper 规避 / 挨打逃跑) 不经此门, 不受影响。
export const NIGHT_MINE_KIND_RE = /^(DUSK_MINE_NIGHT|MINE_THROUGH_NIGHT|NIGHT_STONE_BOOTSTRAP)$/;   // ★T-0175 木镐夜就地下挖取圆石也是下挖即庇护
export const DISPATCHER_FRESH_MS = 10000;

// ★T-0182 #15 (让位必须有人接): 派发器心跳只证明 kernelDriver 活着, 不证明夜挖在跑 —— 3 连败冷却、reflexBusy 让位、
//   承诺刚翻还没派的空档里心跳照新, 反射却已为"在下挖"让出夜宿 → 地表站着过夜。接收方此刻在干活 =
//   承诺的技能就是当前技能 (customSkill 置 bot._currentSkill), 或 15s 内有技能挖掘 (purposefulDigActive),
//   或承诺 ≤10s 新 (派发在路上)。
export function nightMiningReceiverActive(bot, now = Date.now()) {
    const c = bot && bot._commitment;
    if (!c) return false;
    if (c.skill && bot._currentSkill === c.skill) return true;
    if (purposefulDigActive(bot, now)) return true;
    return Number.isFinite(c.since) && now - c.since < DISPATCHER_FRESH_MS;
}

// ★T-0282: the reflex must yield to a night descent only when the decision layer would still propose it — the SAME
//   descent gate world_model applies before any descent (T-0237 descentBlocked hp/starving, T-0243 raw hostile ≤4b).
//   Gate open → digging down is the shelter (with progress); gate closed → the hold keeps the body, and the decision
//   layer has no business proposing a night descent either.
function invCountsOf(bot) {
    const c = {};
    try { for (const it of (bot.inventory && bot.inventory.items ? bot.inventory.items() : [])) if (it && it.name) c[it.name] = (c[it.name] || 0) + (it.count || 0); } catch (e) {}
    return c;
}
export function descentGateOpen(bot) {
    try {
        if (descentBlocked({ food: bot.food, counts: invCountsOf(bot), hp: bot.health })) return false;
        return hostileRawNear(bot, DESCENT_HOSTILE_R) === 0;
    } catch (e) { return false; }
}

export function decisionOwnsNightMining(bot, { hostilesNear = 0, now = Date.now() } = {}) {
    try {
        const c = bot && bot._commitment;
        if (!c || !NIGHT_MINE_KIND_RE.test(String(c.kind || ''))) return false;
        if (!bot._kernelDriverActive || now - bot._kernelDriverActive > DISPATCHER_FRESH_MS) return false;
        if (!nightMiningReceiverActive(bot, now)) return false;
        if (!descentGateOpen(bot)) return false;
        return hostilesNear === 0;
    } catch (e) { return false; }
}

// ★T-0186 (监工: 把 T-0185 从 STONE_BOOTSTRAP 一档推广到整条夜链)。computeNightPlan 每档决策对应 world_model 夜 switch
// 里 push 的 kind; 某档 kind 在派发冷却中时, 返回它 = 提案被 proposeTasks 的冷却过滤剔掉 = 整夜没有夜计划。
// 统一: 按链序挑第一个"条件成立且 kind 未冷却"的候选; 链尾 (SEAL_FORT 物理下限) 是终兜底, 冷却也照返 (不改 NONE, 见 modes.js 红线)。
export const NIGHT_DECISION_KIND = Object.freeze({
    GO_BED: 'DUSK_GO_BED',
    SMELT_IRON: 'NIGHT_SMELT_IRON',
    MINE_THROUGH_NIGHT: 'DUSK_MINE_NIGHT',
    STONE_BOOTSTRAP: 'NIGHT_STONE_BOOTSTRAP',
    DIG_ONE_CAP: 'NIGHT_DIG_ONE',
    SEAL_FORT: 'NIGHT_SEAL',
});
// ★T-0274: building the night shelter is a safety action — a reflex that pins the body to save hunger (famineBodyFreeze)
//   must yield to it. 10-11 06:06-06:08: FOOD_FLOOR→NIGHT_DIG_ONE flip, freeze cleared nightShelter's controls every tick,
//   hp1 bot stood on the surface 2m16s. Only the shelter kinds — night mining is ordinary work and stays frozen at food 0.
export const NIGHT_SHELTER_KIND_RE = new RegExp(`^(${NIGHT_DECISION_KIND.DIG_ONE_CAP}|${NIGHT_DECISION_KIND.SEAL_FORT})$`);
export function shelterOwnsBody({ skill = '', commitmentKind = '' } = {}) {
    return skill === 'nightShelter' || NIGHT_SHELTER_KIND_RE.test(commitmentKind || '');
}
export function nightDecisionCooled(decision, cooldownUntil, now = Date.now()) {
    const k = NIGHT_DECISION_KIND[decision];
    return !!(k && cooldownUntil && cooldownUntil[k] > now);
}
/** candidates: [{ decision, when: bool | () => bool (懒求值, 只在走到这一档才算), build: () => plan, terminal? }]。
 *  先看冷却再求 when (冷却档的昂贵扫描不跑)。 */
export function pickFirstNotCooled(candidates, cooldownUntil, now = Date.now()) {
    for (const c of candidates || []) {
        if (!c) continue;
        if (c.terminal) return { ...c.build(), ...(nightDecisionCooled(c.decision, cooldownUntil, now) ? { cooled: true } : {}) };
        if (nightDecisionCooled(c.decision, cooldownUntil, now)) continue;
        const ok = typeof c.when === 'function' ? c.when() : !!c.when;
        if (ok) return c.build();
    }
    return { decision: 'NONE', reason: 'all night plans unavailable or cooled' };
}
