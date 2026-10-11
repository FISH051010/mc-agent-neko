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
/** ★T-0189 头顶见天: 头部方块 skyLight≥14 → true; <14 → false; 无光照数据 → null (调用方回落 y 判据)。 */
export function skyOpenAt(bot) {
    try {
        const p = bot.entity.position;
        const b = bot.blockAt(p.offset ? p.offset(0, 1, 0) : { x: p.x, y: p.y + 1, z: p.z });
        if (!b || !Number.isFinite(b.skyLight)) return null;
        return b.skyLight >= 14;
    } catch (e) { return null; }
}

export const DESCENT_MIN_HP = 10;
// ★T-0188 (监工: 07:15 hp=11 food=11 零食物不回血, FOOD_FLOOR 无状态触发 hp<10 与 arbiter eatFloor hp≤12 口径不一 → hp 10-12 卡死):
//   "回不了血" 统一判据 hp≤REGEN_HP_MAX 且 food<FOOD_RELEASE — FOOD_FLOOR 会话触发 / arbiter.eatFloor / pickAutoEatFood 应急档三处共用。
export const REGEN_HP_MAX = 12;
// ★T-0237 养伤锁存 (监工指派, worker-death 复盘挂起期 #1/#3/#6/#8: 死前 20-62min hp≤10 不回血, 决策层照派 MIGRATE/REPLENISH_KIT/
//   GET_PORTAL_KIT/reclaimFurnace, #3 hp1 被 migrate 带着迎面走向骷髅)。入口与 descentBlocked 同一条线 (hp < DESCENT_MIN_HP),
//   回到 HEAL_RELEASE_HP 才放手 (迟滞, 防 9↔10 抖动)。状态可由 hp 重建, 重启只丢中间带 (10-15) 的锁存, 可接受。
export const HEAL_RELEASE_HP = 16;
export function healLatchNext(active, hp) {
    if (!Number.isFinite(hp)) return !!active;
    if (hp < DESCENT_MIN_HP) return true;
    if (hp >= HEAL_RELEASE_HP) return false;
    return !!active;
}
/** 养伤期间不派的出门/迁移/远行类 kind (下矿类已由 descentBlocked 按技能名剔除; 这里补非下矿的出门任务)。 */
export const HEAL_RISKY_KINDS = new Set(['MIGRATE', 'REPLENISH_KIT', 'GET_PORTAL_KIT', 'RECLAIM_FURNACE', 'GET_BED', 'HUNT_PEARLS', 'BANK_GEAR',
    'GET_IRON_ARMOR_SET', 'GET_DIAMOND', 'GO_UNDERGROUND', 'DUSK_MINE_NIGHT', 'MINE_THROUGH_NIGHT', 'NIGHT_STONE_BOOTSTRAP', 'OPENING_SCOUT', 'GET_BLAZE_RODS', 'ENTER_NETHER', 'GO_END']);
export function cannotRegen(hp, food) { return Number.isFinite(hp) && Number.isFinite(food) && hp <= REGEN_HP_MAX && food < FOOD_RELEASE; }
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
// ★T-0134 (18:40:50Z 死亡复盘): 锁存只在内存 → 18:38 重启后丢失, food 15 不 ≤6 不再触发, hp 停在 1 (food<18 不回血)
//   → 一次挖出窒息即死、铁装全丢。触发也要看"回不了血": hp<10 且 food<18 同样开会话 — 状态可由 hp/food 重建, 不怕重启。
// ★T-0210 (监工, 10:21-10:26 实录: 白天 food 一直 8-9, 卡在 GET_BED 门 food≥10 与 FOOD_FLOOR 门 food≤6 之间, 两件都不做,
//   挖到黄昏 food 才掉到 6, 而 FOOD_FLOOR 只在白天 → 饿着过夜, 明早更低): 两个新触发, 都以会话形式补到 18 —
//   ①入夜前补餐: tod 9000-12000 (黄昏前约 2min) 且 food<14; ②床待做且 food<10: 先补餐再找羊 (不让两个都不做)。
export const PRE_DUSK_TOD_LO = 9000, PRE_DUSK_TOD_HI = 12000, PRE_DUSK_FOOD = 14, BED_PENDING_FOOD = 10;
// ★T-0245 顺路补粮 (监工 03:04-03:06Z: food 6 才出发找吃的时包里零食物, 上浮+侦察 ~4min 吃到 0, 饥饿 70s 把 hp 18 打到 1 —
//   FOOD_FLOOR=6 对'包里零可吃'太晚): 包里零可吃且 food≤STOCK_FOOD 且附近已看见动物 (animalInRange, 不侦察漫游) → 开会话顺路猎,
//   目标吃到 18 并攒 ≥STOCK_COOKED 份熟食 (释放判据同既有锁存)。看不见动物不触发 — 不为存粮侦察。
export const STOCK_FOOD = 12;
export function latchTrigger({ food, hp, tod, bedPending, counts, animalNear }) {
    if (food <= FOOD_FLOOR) return 'starving';
    if (cannotRegen(hp, food)) return 'regen';
    if (Number.isFinite(tod) && tod >= PRE_DUSK_TOD_LO && tod < PRE_DUSK_TOD_HI && food < PRE_DUSK_FOOD) return 'dusk';
    if (bedPending && food < BED_PENDING_FOOD) return 'bed';
    if (food <= STOCK_FOOD && animalNear && counts && countMatching(counts, EDIBLE_RE) === 0) return 'stock';
    return null;
}
export function updateFoodFloorLatch(latch, { food, counts, animalNear, hp, tod, bedPending, now = Date.now() }) {
    const L = latch || { active: false, kills: 0, since: 0 };
    if (!L.active) { const reason = latchTrigger({ food, hp, tod, bedPending, counts, animalNear }); return reason ? { active: true, kills: 0, since: now, reason } : L; }
    const cooked = countMatching(counts, COOKED_RE);
    const fed = food >= FOOD_RELEASE;
    if (L.kills >= SESSION_KILL_CAP || (fed && (cooked >= STOCK_COOKED || !animalNear)))
        return { active: false, kills: L.kills, since: L.since, releasedAt: now };
    return L;
}

/** 决策判据 (纯函数)。返回 null 或 proposal 片段。latch 缺省时退回旧口径 (food≤6 且零可吃)。 */
export function foodFloorProposal({ foodInstincts, overworld, phase, food, actionable, counts, animal, botY, botPos, depthBand, latch, hp, skyOpen }) {
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
    // ★T-0156 (监工加急 10-10): 19:56:59 y18 food 4-6 (未到 starving≤3) → 只带 scout 不带 surfaceFirst →
    //   矿道里侦察 0.4s 就"found nothing" ×3 → 冷却。地下要侦察就必须先上浮; 地下判据也认 botY<62 (不只 depthBand)。
    // ★T-0189 (23:21:15Z 实录: y61 本在地表 mob=FREE → 被判地下 → surfaceUp 空转): 头顶见天 (skyOpen=true) 一律不算地下;
    //   确知不见天 (false) 算地下; 无光照数据 (null/undefined) 才回落 y/depthBand 判据。
    const underground = skyOpen === true ? false
        : (skyOpen === false || (Number.isFinite(botY) && botY < 62) || !!(depthBand && depthBand !== 'surface'));
    // ★监工加急 #2 + 拍板: 侦察只在 food≤6 时做 (锁存期间 food 已回 7-17 且附近没动物 → 不提, 不为存粮侦察)。
    // ★T-0188 补: "回不了血" (hp≤12 且 food<18) 且包里零可吃 也要侦察/先上浮 — 这是为回血不是存粮 (07:15 hp11 food11 地下零动物 → 不提 → 带 11 血下矿)。
    // ★T-0210: 入夜前补餐 / 床待做补餐 两种会话也侦察 (目标吃到 18, 复用目击记忆的定向侦察) — 包里有吃的就不必去猎
    const plannedMeal = !!(latch && latch.active && (latch.reason === 'dusk' || latch.reason === 'bed')) && countMatching(counts, EDIBLE_RE) === 0;
    const huntNeed = food <= FOOD_FLOOR || (cannotRegen(hp, food) && countMatching(counts, EDIBLE_RE) === 0) || plannedMeal;
    const needScout = huntNeed && !animalOk && rawMeat === 0;
    const surfaceFirst = underground && (starving || needScout);
    const scout = huntNeed && !surfaceFirst && !animalOk && rawMeat === 0;
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
                : `food ${food}≤${FOOD_FLOOR} underground (${depthBand || `y${Math.round(botY)}`}), no animal — surface first, then bounded scout/hunt ≤${HUNT_RADIUS}b`),
    };
}

/** 完成判据: 有锁存看锁存 (迟滞释放); 否则旧口径。 */
export function foodFloorDone({ food, counts, latch }) {
    if (latch) return !latch.active || (latch.kills || 0) >= SESSION_KILL_CAP;
    return food > FOOD_FLOOR || countMatching(counts, EDIBLE_RE) > 0;
}
