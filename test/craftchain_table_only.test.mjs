// T-0060: TOOL_UPKEEP 部分维护派 craftChain([[crafting_table,1]]) — craftChain 只在 STEP 2(有需台配方)造台、
// STEP 3 又跳过台 → 单要台的清单永远零产出 → 3 连败冷却 (10-10 16:26 实录)。skill 层必须造出清单里的每一项。
import test from 'node:test';
import assert from 'node:assert/strict';
import craftChain from '../bots/_supervisor/skills/craftChain.js';

function fakeCtx(inv) {
    const bot = {
        inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, type: name, count })) },
        recipesFor: (id) => [{ id, delta: [] }],
        craft: async (r, count) => {
            if (r.id === 'crafting_table') { if ((inv.spruce_planks || 0) < 4) throw new Error('missing'); inv.spruce_planks -= 4; inv.crafting_table = (inv.crafting_table || 0) + count; }
            else if (r.id === 'stick') { inv.spruce_planks -= 2; inv.stick = (inv.stick || 0) + 4 * count; }
            else if (r.id === 'spruce_planks') { inv.spruce_log -= count; inv.spruce_planks = (inv.spruce_planks || 0) + 4 * count; }
        },
        entity: { position: { floored: () => ({ x: 0, y: 64, z: 0 }) } },
    };
    const ctx = {
        skills: { moveAway: async () => {}, wait: async () => {}, placeBlock: async () => {}, collectBlock: async () => {} },
        world: { getNearestBlock: () => null, getInventoryCounts: () => ({ ...inv }) },
        mc: { getItemId: (n) => n },
        Vec3: class {}, log: () => {},
    };
    return { bot, ctx };
}

test('T-0060: craftChain([[crafting_table,1]]) 有板时必须造出随身台 (不得零产出)', async () => {
    const inv = { spruce_planks: 6, stick: 6, wooden_pickaxe: 3 };   // 16:26 live after the first dispatch folded planks
    const { bot, ctx } = fakeCtx(inv);
    const r = await craftChain(bot, ctx, [['crafting_table', 1]]);
    assert.equal(inv.crafting_table, 1);
    assert.ok(r && r.crafted >= 1, 'truthy progress so the kernel does not strike it');
});

test('T-0060: 只揣原木 → [折板, 台, 棍] 一次派发全部造出', async () => {
    const inv = { spruce_log: 11, stick: 2, wooden_pickaxe: 3 };
    const { bot, ctx } = fakeCtx(inv);
    await craftChain(bot, ctx, [['spruce_planks', 2], ['crafting_table', 1], ['stick', 1]]);
    assert.equal(inv.crafting_table, 1);
    assert.equal(inv.stick, 6);
});
