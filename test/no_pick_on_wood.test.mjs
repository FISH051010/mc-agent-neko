// T-0118: chopWood 树冠收割/漏斗挖拿木镐砍原木和树叶 — 零提速, 白耗耐久; 实录 16:16→16:20 三把木镐磨到一把,
// 补木↔补镐循环把 bot 挡在石器时代之前。取工具 choke-point 必须在木/叶上把镐(锹/锄/剑)换成空手。
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBareHand } from '../src/agent/library/tool_choice.js';
import { equipForDig } from '../src/agent/library/skills.js';

test('T-0118: 判据 — 木/叶上的镐必须空手, 斧/剪/锄合理保留, 石头上的镐不动', () => {
    assert.equal(shouldBareHand('spruce_log', 'wooden_pickaxe'), true);
    assert.equal(shouldBareHand('spruce_leaves', 'wooden_pickaxe'), true);
    assert.equal(shouldBareHand('oak_log', 'stone_sword'), true);
    assert.equal(shouldBareHand('oak_log', 'stone_axe'), false, 'axe is the right tool for wood');
    assert.equal(shouldBareHand('oak_leaves', 'shears'), false);
    assert.equal(shouldBareHand('stone', 'wooden_pickaxe'), false);
    assert.equal(shouldBareHand('spruce_log', null), false);
});

test('T-0118: equipForDig — 手握木镐、equipForBlock 不换工具 (木头上镐不比手快) → 砍原木前必须空手', async () => {
    let held = { name: 'wooden_pickaxe' };
    const bot = {
        get heldItem() { return held; },
        inventory: { items: () => [{ name: 'wooden_pickaxe', count: 3 }] },
        tool: { equipForBlock: async () => {} },          // mineflayer-tool: nothing faster → keeps current item
        unequip: async () => { held = null; },
        equip: async (it) => { held = it; },
    };
    await equipForDig(bot, { name: 'spruce_log' });
    assert.equal(held, null, 'bare hand on wood');
    held = { name: 'wooden_pickaxe' };
    await equipForDig(bot, { name: 'spruce_leaves' });
    assert.equal(held, null, 'bare hand on leaves');
});
