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
    const needsCobble = wants.some(([n]) => n === 'stone_pickaxe');
    if (wants.length && (!needsCobble || cobble >= 3) && woodUnits >= Math.max(2, woodCost(wants)))
        return { wants: withPlanks(wants, counts), partial: false };
    const sub = wants.filter(([n]) => n !== 'stone_pickaxe');
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
export function needsToolUpkeep({ sufficientForUnderground, pickTier, counts }) {
    counts = counts || {};
    const cobble = (counts['cobblestone'] || 0) + (counts['cobbled_deepslate'] || 0);
    const escortMissing = IRON_PLUS_RE.test(pickTier || '') && (counts['stone_pickaxe'] || 0) === 0 && cobble >= 3;
    return !sufficientForUnderground || (!PICK_DURABLE_RE.test(pickTier || '') && cobble >= 3) || escortMissing;
}
