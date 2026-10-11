// ★T-0239 楔死升级计数 — "同一处反复楔死" 按地点+时间窗累加, 不随寻路停/起或原地微晃清零。
//
// Live 10-11 01:58-01:59Z @104.3,80,-2.3 (云杉树冠下, quickMeal 侦察): edge_unstick 'replan #1' ×16 / 2min, 从未到 #2。
// 旧计数在 !moving (pathfinder 停→下一条腿之间 isMoving=false) 与 ≥0.05b 微位移时清零 → 后退+侧移分支永远走不到。
// 人反复撞同一个地方就会退一步换个角度; 走开了 (>RADIUS) 或隔了很久 (>WINDOW) 才算新的一处。
export const WEDGE_STREAK_WINDOW_MS = 30000;
export const WEDGE_STREAK_RADIUS = 3;

/** Record a wedge at p (horizontal) at `now`; returns the streak for this spot (1 = first). Mutates st.resetStreak / st._wedgeSpot. */
export function bumpWedgeStreak(st, p, now) {
    const last = st._wedgeSpot;
    const near = !!last && now - last.at <= WEDGE_STREAK_WINDOW_MS && Math.hypot(p.x - last.x, p.z - last.z) <= WEDGE_STREAK_RADIUS;
    st.resetStreak = near ? (st.resetStreak || 0) + 1 : 1;
    st._wedgeSpot = { x: near ? last.x : p.x, z: near ? last.z : p.z, at: now };
    return st.resetStreak;
}
