// ★T-0069 有界食物闭环 (FOOD_FLOOR) — 不违背用户 07-08 令 MC_FOOD_INSTINCTS=0 (禁主动觅食/种田/漫游)的最小兜底。
// 实录 10-10: 铁器 bot (3 铁镐/铁剑/盔+靴) food 13→6、背包零食物、hp17 不回血; keepInventory=false →
// 饿到 hp1 后任何一击即死、铁装全丢。食物本能整体关闭时, 没有任何提案能补 food。
// 边界 (全部硬上限, 不漫游):
//   · 仅食物本能关闭时生效 (开着时 GET_FOOD 负责, 不重复);
//   · 白天、无可行动威胁、主世界;
//   · food ≤ FOOD_FLOOR 且背包无现成可吃食物 (有就交给进食反射);
//   · 只认 HUNT_RADIUS 格内、高差 ≤ HUNT_DY、近 25s 内见过的动物; 或背包已有生肉 (只烤/吃, 不走动);
//   · 执行技能 quickMeal 整体 ≤ maxMs, 找不到就如实失败 → kernel 3 连败冷却, 不追不逛。
export const FOOD_FLOOR = 6;
// ★监工拍板 10-10 01:4x: 半径 16→48 (水平, 步行 ~11s 仍有界), 高差 4→6。实录 17:37 最近的牛 34 格 → 16 格永不触发。
export const HUNT_RADIUS = 48;
export const HUNT_DY = 6;
export const FOOD_FLOOR_PRIORITY = 70;
export const QUICK_MEAL_MAX_MS = 60000;
// ★饥饿禁下矿 (监工拍板): food≤3 且零可吃 → 不提出、不继续任何往深处走的承诺; 在矿里的先上浮觅食。
//   人类饿到 2 绝不钻深矿: 不能疾跑、不回血; keepInventory 关 → 一死丢光铁装。
export const STARVING_FOOD = 3;
export const DESCENT_SKILL_RE = /^(mineDown|mineDiamonds|mineOres|branchMine)$/;
export const SURFACE_FIRST_MAX_MS = 120000;
export const SCOUT_RADIUS = 96;
export const SCOUT_MS = 90000;

const EDIBLE_RE = /^(cooked_\w+|bread|apple|golden_apple|baked_potato|carrot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|mushroom_stew|beetroot_soup|rabbit_stew|dried_kelp)$/;
const RAW_MEAT_RE = /^(beef|porkchop|mutton|chicken|rabbit)$/;
export const HUNTABLE_RE = /^(cow|pig|sheep|chicken|mooshroom|rabbit)$/;

export function countMatching(counts, re) {
    let n = 0;
    for (const k of Object.keys(counts || {})) if (re.test(k)) n += counts[k] || 0;
    return n;
}

/** 饿着且零可吃 (禁下矿判据)。 */
export function starvingNoFood({ food, counts }) {
    return Number.isFinite(food) && food <= STARVING_FOOD && countMatching(counts, EDIBLE_RE) === 0;
}

/** 水平距离 (监工口径: 48 格按水平算); 拿不到 bot 坐标时退回 3D dist (更保守)。 */
function horizDist(animal, botPos) {
    if (botPos && Number.isFinite(animal.x) && Number.isFinite(animal.z) && Number.isFinite(botPos.x) && Number.isFinite(botPos.z))
        return Math.hypot(animal.x - botPos.x, animal.z - botPos.z);
    return animal.dist;
}

// ★监工拍板 (18:2x 实机闭环跑通后): 迟滞 — food≤6 触发, 补到 food≥18(回血线) 且熟食≥4 才释放; 附近确实没动物时
//   food≥18 即可释放 (不为凑存粮去侦察); 一次会话最多猎 SESSION_KILL_CAP 只 (防把一片打光后漫游)。
//   旧口径 food>6 即完成 → hp 停在 1 (food<18 不回血), 一碰即死、丢铁装。
export const FOOD_RELEASE = 18;
export const STOCK_COOKED = 4;
export const SESSION_KILL_CAP = 6;
export const DESCENT_MIN_HP = 10;
const COOKED_RE = /^(cooked_\w+|bread|baked_potato)$/;

/** 下矿门 (监工拍板): 饿着零可吃 或 hp<10 → 不提出/不继续下矿。 */
export function descentBlocked({ food, counts, hp }) {
    return starvingNoFood({ food, counts }) || (Number.isFinite(hp) && hp < DESCENT_MIN_HP);
}

/** 动物在猎程内 (水平 ≤HUNT_RADIUS、高差 ≤HUNT_DY、25s 内见过)。 */
export function animalInRange(animal, botPos, botY) {
    const y = Number.isFinite(botY) ? botY : (botPos && botPos.y);
    return !!(animal && Number.isFinite(animal.dist) && horizDist(animal, botPos) <= HUNT_RADIUS
        && (!Number.isFinite(y) || !Number.isFinite(animal.y) || Math.abs(animal.y - y) <= HUNT_DY)
        && (animal.age == null || animal.age <= 25000));
}

/** 会话锁存 (纯函数; 状态由调用方挂在 bot._foodFloorLatch)。 */
export function updateFoodFloorLatch(latch, { food, counts, animalNear, now = Date.now() }) {
    const L = latch || { active: false, kills: 0, since: 0 };
    if (!L.active) return food <= FOOD_FLOOR ? { active: true, kills: 0, since: now } : L;
    const cooked = countMatching(counts, COOKED_RE);
    const fed = food >= FOOD_RELEASE;
    if (L.kills >= SESSION_KILL_CAP || (fed && (cooked >= STOCK_COOKED || !animalNear)))
        return { active: false, kills: L.kills, since: L.since, releasedAt: now };
    return L;
}

/** 决策判据 (纯函数)。返回 null 或 proposal 片段。latch 缺省时退回旧口径 (food≤6 且零可吃)。 */
export function foodFloorProposal({ foodInstincts, overworld, phase, food, actionable, counts, animal, botY, botPos, depthBand, latch }) {
    if (foodInstincts || !overworld || phase !== 'day' || (actionable || 0) > 0) return null;
    if (latch) {
        if (!latch.active || (latch.kills || 0) >= SESSION_KILL_CAP) return null;
    } else {
        if (!(food <= FOOD_FLOOR)) return null;
        if (countMatching(counts, EDIBLE_RE) > 0) return null;
    }
    const rawMeat = countMatching(counts, RAW_MEAT_RE);
    const animalOk = animalInRange(animal, botPos, botY);
    // 饿着还在矿里 → 先上浮再在地面找 (监工拍板: 在矿里的要先回地面去觅食)
    const starving = starvingNoFood({ food, counts });
    const surfaceFirst = starving && depthBand && depthBand !== 'surface';
    // ★监工加急 #2 + 拍板: 侦察只在 food≤6 时做 (锁存期间 food 已回 7-17 且附近没动物 → 不提, 不为存粮侦察)。
    const scout = food <= FOOD_FLOOR && !surfaceFirst && !animalOk && rawMeat === 0;
    if (rawMeat === 0 && !animalOk && !surfaceFirst && !scout) return null;
    const args = [{ radius: HUNT_RADIUS, maxDy: HUNT_DY, maxMs: QUICK_MEAL_MAX_MS,
        // ★监工加急#3: surfaceFirst 必须连带侦察 — 上浮后看不到动物就侦察, 不直接失败
        ...(surfaceFirst && rawMeat === 0 ? { surfaceFirst: true, surfaceMaxMs: SURFACE_FIRST_MAX_MS } : {}),
        ...((scout || (surfaceFirst && rawMeat === 0 && !animalOk)) ? { scout: true, scoutRadius: SCOUT_RADIUS, scoutMs: SCOUT_MS, scoutToward: animal && Number.isFinite(animal.x) ? { x: animal.x, z: animal.z } : null } : {}) }];
    if (scout) return { priority: FOOD_FLOOR_PRIORITY, args,
        rationale: `food ${food}≤${STARVING_FOOD} starving, no animal ≤${HUNT_RADIUS}b — bounded scout ≤${SCOUT_RADIUS}b/${SCOUT_MS / 1000}s (safe path, hunt on sight)` };
    return {
        priority: FOOD_FLOOR_PRIORITY,
        args,
        rationale: rawMeat > 0
            ? `food ${food}≤${FOOD_FLOOR}, no edible, ${rawMeat} raw meat — cook/eat in place (bounded, food instincts off)`
            : (animalOk
                ? `food ${food}≤${FOOD_FLOOR}, no edible — one short hunt of ${animal.meta || 'animal'} (≤${HUNT_RADIUS}b, bounded, food instincts off)`
                : `food ${food}≤${STARVING_FOOD} starving underground (${depthBand}) — surface first, then one hunt ≤${HUNT_RADIUS}b (bounded)`),
    };
}

/** 完成判据: 有锁存看锁存 (迟滞释放); 否则旧口径。 */
export function foodFloorDone({ food, counts, latch }) {
    if (latch) return !latch.active || (latch.kills || 0) >= SESSION_KILL_CAP;
    return food > FOOD_FLOOR || countMatching(counts, EDIBLE_RE) > 0;
}
