// ★T-0264 one "make sure I can craft 3x3 right here" primitive (监工加急, 镐耗尽风险).
//
// Live 10-11 04:46:34 / 04:46:43Z: mineDown 'fodder-recraft: stone_pickaxe → fail' ×2 at y18 with one wooden pick left and
// cobblestone 135 / stick 8 / birch_planks 8 / birch_log 10 in the pack — but no crafting_table. craftRecipeLocal places and
// reclaims a CARRIED table; without one a 3x3 recipe simply fails. surfaceUp had its own private ensureTable for the same
// job. A human crafts a table from planks (planks from a log first) and goes on. Pure over injected I/O so it is testable
// and loads fresh from hot-reloaded skills (new module).
const LOG_RE = /^(?:stripped_)?([a-z_]+?)_(log|wood|stem|hyphae)$/;

/** birch_log → birch_planks, crimson_stem → crimson_planks, stripped_oak_log → oak_planks. */
export function plankForLog(name) {
    const m = LOG_RE.exec(name || '');
    return m ? `${m[1]}_planks` : null;
}

/**
 * Ensure a crafting table is carried or within reach. counts() → {item: n}; craftLocal(name, n) → crafts from the pocket
 * (2x2 recipes: planks, crafting_table); nearTable() → bool. Returns true when a table is carried/near afterwards.
 */
export async function ensureCarriedTable({ counts, craftLocal, nearTable = () => false, log = () => {} }) {
    let c = counts() || {};
    if ((c.crafting_table || 0) > 0) return true;
    try { if (nearTable()) return true; } catch (e) {}
    const planks = () => Object.keys(c).filter(k => k.endsWith('_planks')).reduce((s, k) => s + (c[k] || 0), 0);
    if (planks() < 4) {
        const log0 = Object.keys(c).find(k => (c[k] || 0) > 0 && plankForLog(k));
        if (!log0) { log('ensureCarriedTable: no planks and no logs — cannot make a table'); return false; }
        try { await craftLocal(plankForLog(log0), 1); } catch (e) {}
        c = counts() || {};
        if (planks() < 4) { log(`ensureCarriedTable: ${log0} → planks failed`); return false; }
    }
    try { await craftLocal('crafting_table', 1); } catch (e) {}
    c = counts() || {};
    const ok = (c.crafting_table || 0) > 0;
    log(`ensureCarriedTable: crafted a pocket table → ${ok ? 'OK' : 'fail'}`);
    return ok;
}
