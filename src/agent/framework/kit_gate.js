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
