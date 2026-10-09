// ★T-0136 决策层夜挖 vs 反射预防性封箱 — 契约必须一致。
// 实录 10-10 18:47:23Z: 决策层 computeNightPlan 选 MINE_THROUGH_NIGHT → kernel 派 mineDown(DUSK_MINE_NIGHT);
// 同刻 bot 在 y59 (≥50 且 enclosed=false) → self_preservation.shouldNightShelter=true → bunkerDown "sealed night hold"
// 抢身体 → mineDown 每次 ~3.6s 秒退 → 3 连败 → DUSK_MINE_NIGHT 冷却 5min → FREE_PLAY 站着过夜 (零产出)。
// 下挖本身就是庇护 (地下即安全, 正是 shouldNightShelter 对 y<50 豁免的理由): 决策层已承诺夜挖 + 派发器在线 +
// 附近无怪 → 预防性封箱让位。反应式防御 (shouldFlee / creeper 规避 / 挨打逃跑) 不经此门, 不受影响。
export const NIGHT_MINE_KIND_RE = /^(DUSK_MINE_NIGHT|MINE_THROUGH_NIGHT)$/;
export const DISPATCHER_FRESH_MS = 10000;

export function decisionOwnsNightMining(bot, { hostilesNear = 0, now = Date.now() } = {}) {
    try {
        const c = bot && bot._commitment;
        if (!c || !NIGHT_MINE_KIND_RE.test(String(c.kind || ''))) return false;
        if (!bot._kernelDriverActive || now - bot._kernelDriverActive > DISPATCHER_FRESH_MS) return false;
        return hostilesNear === 0;
    } catch (e) { return false; }
}
