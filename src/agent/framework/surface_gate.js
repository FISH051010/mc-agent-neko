// surfaceGate 自动档判定 (原 modes.js 内联, 抽出供 test 钉死)。
// ★T-0125 (10-10 17:18→ 实录): 'low food' hold 不看食物本能开关 — MC_FOOD_INSTINCTS=0 时 bot 不会获取任何
// 食物, food<14 就永远 hold → tierReady / GO_UNDERGROUND 全被 `surfaceGate.mode !== 'hold'` 挡死 →
// 承诺落到 FREE_PLAY@1, 铁器 bot (3 铁镐/盔+靴, 圆石 339) 白天在地表罚站 5min+。决策层其余食物门在开关关时
// 一律放行 (foodSafeForUnderground / tierReady 的 `!foodInstincts ||`), 此处同口径: 一个无法被任何提案满足的
// hold 只是死锁, 不是避险。
export function surfaceGateAuto({ isNight, isDusk, actionable, sufficientForUnderground, picks, foodSufficient, foodInstincts }) {
    if (isNight || isDusk) return { mode: 'hold', reason: 'night/dusk' };
    if (actionable > 0) return { mode: 'hold', reason: `actionable threat x${actionable}` };
    if (!sufficientForUnderground) {
        if (picks === 0) return { mode: 'free', reason: 'bootstrap: surface for wood→pick' };
        return { mode: 'hold', reason: 'kit insufficient (picks)' };
    }
    if (!foodSufficient && foodInstincts) return { mode: 'hold', reason: 'low food' };
    return { mode: 'free', reason: foodSufficient ? 'safe day, kitted' : 'safe day, kitted (low food; food instincts off — hold would never clear)' };
}
