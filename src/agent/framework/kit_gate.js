// ★T-0088/T-0060/T-0012 underground descent kit gate, extracted verbatim from modes.js's world-model
// kit block so test/kit_gate.test.mjs can pin it (回归测试钉死). See the comments at the modes.js call
// site for the full 石棺死锁 rationale. Pure: counts = world.getInventoryCounts(bot).
export function undergroundKitGate({ picks, durablePick, counts }) {
    counts = counts || {};
    const planksMax = Math.max(0, ...Object.keys(counts).filter(k => k.endsWith('_planks')).map(k => counts[k] || 0));
    const logs = Object.keys(counts).filter(k => k.endsWith('_log')).reduce((s, k) => s + (counts[k] || 0), 0);
    const cobble = counts['cobblestone'] || 0;
    const sticks = counts['stick'] || 0;
    const carriedTable = (counts['crafting_table'] || 0) > 0;
    const woodForRecraft = planksMax + logs * 4;                 // planks on hand + logs→4 planks each
    const planksToRecraft = (carriedTable ? 0 : 4) + (sticks >= 2 ? 0 : 2);  // table (if none) + sticks (if none)
    const canRecraftPick = cobble >= 3 && woodForRecraft >= planksToRecraft;
    const sufficientForUnderground = picks >= 1 && (durablePick || picks >= 2) && ((picks >= 2 && carriedTable) || canRecraftPick);
    return { sufficientForUnderground, canRecraftPick, carriedTable };
}

// ★T-0060 (10-10 新世界实录): TOOL_UPKEEP 只在「全部想要的都造得起」时提案 — 想要 [台, 石镐] 而 0 圆石
// 就整单沉默, 连只要木板的台也不造。bot 揣 3 木镐 + 16 原木 + 0 台 → sufficientForUnderground=false →
// GO_UNDERGROUND 不提, BOOTSTRAP_KIT 已退役 → wood→stone 这一级零提案, 只剩造不出的 GET_BED 空转。
// 现在: 全套造得起 → 照旧全造; 否则去掉缺圆石的石镐, 若剩下的(台/棍)单靠木料就能把下矿门补回来 → 只造这部分
// (下矿拿到圆石后本提案再接力造石镐)。补不回门的部分造 = 白耗木, 不提。
// 返回 wants=[] 表示没有可执行的维护 (proposal 不提 / isGoalDone 视为完成)。
const PICK_DURABLE_RE = /stone|iron|diamond|netherite/;
const woodCost = (ws) => ws.reduce((s, [n]) => s + (n === 'crafting_table' ? 4 : n === 'stick' ? 2 : 0), 0);
// craftChain 只在清单里列出 *_planks 时才折板 (STEP 1) — 只揣原木时台/棍必失败 (10-10 16:23 实录 3 连败→冷却)。
// 板不够就在清单最前补「主力木种折板」步: 1 次合成 = 4 板。
function withPlanks(wants, counts) {
    const need = woodCost(wants);
    const planks = Object.keys(counts).filter(k => k.endsWith('_planks')).reduce((s, k) => s + (counts[k] || 0), 0);
    if (need <= planks) return wants;
    const logs = Object.keys(counts).filter(k => k.endsWith('_log') && counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
    if (!logs.length) return wants;
    return [[logs[0].replace(/_log$/, '_planks'), Math.ceil((need - planks) / 4)], ...wants];
}
export function toolUpkeepPlan({ picks, pickTier, counts, woodUnits }) {
    counts = counts || {};
    const cobble = (counts['cobblestone'] || 0) + (counts['cobbled_deepslate'] || 0);
    const sticks = counts['stick'] || 0;
    const tableCarried = (counts['crafting_table'] || 0) > 0;
    const durable = PICK_DURABLE_RE.test(pickTier || '');
    const wants = [];
    if (!tableCarried) wants.push(['crafting_table', 1]);
    if (sticks < 4) wants.push(['stick', 1]);                       // 1 craft = 4 sticks
    // 木器 tier 有 ≥6 圆石 → 一次造 2 把石镐 (一把石镐 131 耐久, 下矿 3min 就磨光 — 10-10 16:40 实录)
    if (!durable || picks < 2) wants.push(['stone_pickaxe', (!durable && cobble >= 6) ? 2 : 1]);
    // ★T-0130 护航石镐: 铁+镐在手却 0 石镐 → 造 1 把 (挖普通石用它, 护住铁镐; worker-stuck T-0128 diamondDiveReady 要求 ≥1 石镐)
    else if (IRON_PLUS_RE.test(pickTier || '') && (counts['stone_pickaxe'] || 0) === 0) wants.push(['stone_pickaxe', 1]);
    // ★T-0170 随身剑 (death #8 21:17:59Z: 铁镐在手无剑, self_defense 只认剑/斧不出手, 被僵尸三下打死):
    //   无剑 → 镐用掉的圆石之外还剩 ≥2 就顺手造石剑 (2 圆石 + 1 棍)。镐优先: 圆石不够两样都造时先镐。
    const pickCobble = wants.filter(([n]) => n === 'stone_pickaxe').reduce((s, [, k]) => s + 3 * k, 0);
    if (swordMissing(counts) && cobble - pickCobble >= 2) wants.push(['stone_sword', 1]);
    const needsCobble = wants.some(([n]) => /^stone_(pickaxe|sword)$/.test(n));
    if (wants.length && (!needsCobble || cobble >= Math.max(pickCobble ? 3 : 2, pickCobble)) && woodUnits >= Math.max(2, woodCost(wants)))
        return { wants: withPlanks(wants, counts), partial: false };
    const sub = wants.filter(([n]) => !/^stone_(pickaxe|sword)$/.test(n));
    if (sub.length && sub.length < wants.length && woodUnits >= Math.max(2, woodCost(sub))) {
        const after = { ...counts };
        if (sub.some(([n]) => n === 'crafting_table')) after['crafting_table'] = (after['crafting_table'] || 0) + 1;
        if (sub.some(([n]) => n === 'stick')) after['stick'] = sticks + 4;
        if (undergroundKitGate({ picks, durablePick: durable, counts: after }).sufficientForUnderground)
            return { wants: withPlanks(sub, counts), partial: true };
    }
    return { wants: [], partial: false };
}

// ★T-0107 DIG_ONE_CAP (挖三填一) viability, extracted verbatim from modes.js computeNightPlan inputs.
// Requires a REAL pick: a pickless bot "dig_one"-ing soft dirt buries itself under the forest floor
// (live 06-30 @y66→y62 capped → dawn trees all "+4 elevated unreachable" → wood=0 bootstrap deadlock).
// Never in a gravity column, never below y16 (dig_one is a shallow night shelter).
export function digOneCapViable({ picks, gravityPit, y }) {
    return picks >= 1 && !gravityPit && y > 16;
}

// ★T-0118 回归修 (10-10 16:40 实录): 石镐磨光后 tier 掉回木器, 背包 97 圆石 + 2 木镐 + 9 原木 — 下矿门因
// canRecraftPick 照开, TOOL_UPKEEP 只在门关时才提 → 没有任何提案把圆石变成石镐, bot 拿木镐抱着圆石往下挖。
// 维护需求 = 下矿门关, 或 还在木器 tier 却揣着够造石镐的圆石 (人: 有圆石立刻换石镐)。提案端与 isGoalDone 同口径。
// ★T-0130 (worker-stuck 报, 02:26 现场: iron_pickaxe×3 + stone_pickaxe×0 + 圆石 545 + 棍 27): 铁镐在手、下矿门开 →
//   旧判据不需维护 → 永不补护航石镐 → T-0128 的 diamondDiveReady 门让 GET_DIAMOND 永不提出。
const IRON_PLUS_RE = /iron|diamond|netherite/;
/** ★T-0170: 背包里一把剑都没有 (任何材质)。 */
export function swordMissing(counts) {
    return !Object.keys(counts || {}).some(k => /_sword$/.test(k) && (counts[k] || 0) > 0);
}
export function needsToolUpkeep({ sufficientForUnderground, pickTier, counts }) {
    counts = counts || {};
    const cobble = (counts['cobblestone'] || 0) + (counts['cobbled_deepslate'] || 0);
    const escortMissing = IRON_PLUS_RE.test(pickTier || '') && (counts['stone_pickaxe'] || 0) === 0 && cobble >= 3;
    // ★T-0170 每个 tier 随身一把剑: 无剑 + 圆石≥2 即需维护 (2 圆石 + 1 棍, 成本几乎为零)
    const swordGap = swordMissing(counts) && cobble >= 2;
    return !sufficientForUnderground || (!PICK_DURABLE_RE.test(pickTier || '') && cobble >= 3) || escortMissing || swordGap;
}

// ★T-0150 (19:49Z 实录: y21 夜挖, raw_iron 10 + 原木 17 + 0 煤, 无铁镐): 夜间冶炼判据燃料只数 coal/charcoal →
//   木头不算 → SMELT_IRON 永不触发, 10 粗铁锁在包里。而 smeltItem (mcdata.getSmeltingFuel) 本就认原木/木板 (1.5 件/个)。
//   与执行端同口径: 可冶炼件数 = 煤×8 + 木料×1.5, 木料先扣 2 原木留给棍/台 (铁镐柄 + 熔炉 3×3 要台)。
export const WOOD_FUEL_RESERVE_LOGS = 2;
export function smeltableUnits(counts) {
    counts = counts || {};
    const coal = (counts['coal'] || 0) + (counts['charcoal'] || 0);
    const logs = Object.keys(counts).filter(k => k.endsWith('_log')).reduce((s, k) => s + (counts[k] || 0), 0);
    const planks = Object.keys(counts).filter(k => k.endsWith('_planks')).reduce((s, k) => s + (counts[k] || 0), 0);
    const woodItems = Math.max(0, logs - WOOD_FUEL_RESERVE_LOGS) + planks;
    return coal * 8 + Math.floor(woodItems * 1.5);
}

// ★T-0157 (监工加急 10-10; 19:57:04→20:00:06 实录: GET_ARMOR→craftArmor ×3 秒败 → 5min 冷却): 背包 11 粗铁, 但
//   0 原木/0 煤/无台 → smeltSafe "no carried/nearby table and no wood to make one", 后来 4 木板也只够拍台 → consumed=0。
//   决策层提了技能层必拒的 craftArmor (铁律 2)。造一件甲 = 台 (合成) + 熔炉 (缺锭时) + 燃料 (缺锭件数), 缺一不可。
//   口径同 smeltSafe/smeltItem: 台 = 带着/4 格内有/4 木板/1 原木; 熔炉 = 带着/4 格内有/8 圆石类; 燃料 = 煤×8 + 木料×1.5 (扣掉拍台的木)。
const FURNACE_STONE_RE = /^(cobblestone|cobbled_deepslate|blackstone)$/;
export function armorCraftFeasible(counts, cost, { tableNear = false, furnaceNear = false } = {}) {
    counts = counts || {};
    const sum = (re) => Object.keys(counts).filter(k => re.test(k)).reduce((s, k) => s + (counts[k] || 0), 0);
    let logs = sum(/_log$/), planks = sum(/_planks$/);
    if (!tableNear && !(counts['crafting_table'] > 0)) {
        if (planks >= 4) planks -= 4;
        else if (logs >= 1) logs -= 1;   // 1 原木 → 4 木板 → 台, 不剩
        else return { ok: false, why: 'no-table' };
    }
    const needSmelt = Math.max(0, (cost || 0) - (counts['iron_ingot'] || 0));
    if (needSmelt > 0) {
        if (!furnaceNear && !(counts['furnace'] > 0) && sum(FURNACE_STONE_RE) < 8) return { ok: false, why: 'no-furnace' };
        const fuel = ((counts['coal'] || 0) + (counts['charcoal'] || 0)) * 8 + Math.floor((logs + planks) * 1.5);
        if (fuel < needSmelt) return { ok: false, why: `no-fuel ${fuel}<${needSmelt}` };
    }
    return { ok: true, why: '' };
}
