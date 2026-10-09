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
export const HUNT_RADIUS = 16;
export const HUNT_DY = 4;
export const FOOD_FLOOR_PRIORITY = 70;
export const QUICK_MEAL_MAX_MS = 60000;

const EDIBLE_RE = /^(cooked_\w+|bread|apple|golden_apple|baked_potato|carrot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|mushroom_stew|beetroot_soup|rabbit_stew|dried_kelp)$/;
const RAW_MEAT_RE = /^(beef|porkchop|mutton|chicken|rabbit)$/;
export const HUNTABLE_RE = /^(cow|pig|sheep|chicken|mooshroom|rabbit)$/;

export function countMatching(counts, re) {
    let n = 0;
    for (const k of Object.keys(counts || {})) if (re.test(k)) n += counts[k] || 0;
    return n;
}

/** 决策判据 (纯函数)。返回 null 或 proposal 片段。 */
export function foodFloorProposal({ foodInstincts, overworld, phase, food, actionable, counts, animal, botY }) {
    if (foodInstincts || !overworld || phase !== 'day' || (actionable || 0) > 0) return null;
    if (!(food <= FOOD_FLOOR)) return null;
    if (countMatching(counts, EDIBLE_RE) > 0) return null;
    const rawMeat = countMatching(counts, RAW_MEAT_RE);
    const animalOk = !!(animal && Number.isFinite(animal.dist) && animal.dist <= HUNT_RADIUS
        && (!Number.isFinite(botY) || !Number.isFinite(animal.y) || Math.abs(animal.y - botY) <= HUNT_DY)
        && (animal.age == null || animal.age <= 25000));
    if (rawMeat === 0 && !animalOk) return null;
    return {
        priority: FOOD_FLOOR_PRIORITY,
        args: [{ radius: HUNT_RADIUS, maxDy: HUNT_DY, maxMs: QUICK_MEAL_MAX_MS }],
        rationale: rawMeat > 0
            ? `food ${food}≤${FOOD_FLOOR}, no edible, ${rawMeat} raw meat — cook/eat in place (bounded, food instincts off)`
            : `food ${food}≤${FOOD_FLOOR}, no edible — one short hunt of ${animal.meta || 'animal'} @${animal.dist}b (≤${HUNT_RADIUS}b, bounded, food instincts off)`,
    };
}

/** 完成判据: 食物回到地板以上或背包已有可吃的 (与提案同口径)。 */
export function foodFloorDone({ food, counts }) {
    return food > FOOD_FLOOR || countMatching(counts, EDIBLE_RE) > 0;
}
