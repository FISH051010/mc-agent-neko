// T-0060 (10-10 新世界实录): 揣 3 木镐 + 16 原木 + 0 台 + 0 圆石 → TOOL_UPKEEP 因「石镐要圆石」整单沉默 →
// 下矿门永远关 → wood→stone 一级零提案, 只剩造不出的 GET_BED 空转。决策层必须提出「先造台」这一可执行步。
import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeTasks, isGoalDone } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';
import { toolUpkeepPlan, undergroundKitGate } from '../src/agent/framework/kit_gate.js';

const LIVE_INV = { wooden_pickaxe: 3, spruce_log: 16, stick: 15, spruce_planks: 1, rotten_flesh: 2, spruce_sapling: 3 };
const fakeBot = (inv) => ({
    inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 7, y: 74, z: -4 } }, health: 14, food: 12,
});
function dayWorld(kit) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, ...kit };
    return w;
}
const woodOf = (inv) => Object.entries(inv).reduce((s, [n, c]) => s + (/_log$/.test(n) ? c * 4 : /_planks$/.test(n) ? c : 0), 0);

test('T-0060: 3 木镐 + 木料 + 0 台 + 0 圆石 → 必须提 TOOL_UPKEEP 只造台 (不得因缺圆石整单沉默)', () => {
    const bot = fakeBot(LIVE_INV);
    const w = dayWorld({ picks: 3, pickTier: 'wood', sufficientForUnderground: false });
    const tu = proposeTasks(w, bot).find(p => p.kind === 'TOOL_UPKEEP');
    assert.ok(tu, 'TOOL_UPKEEP proposed');
    assert.deepEqual(tu.args[0], [['crafting_table', 1]], 'only the wood-affordable table; no stone pick without cobble');
    assert.equal(isGoalDone('TOOL_UPKEEP', w, bot), false, 'not "done" while the table is still craftable and missing');
});

test('T-0060: 造出台后下矿门即恢复 (这一步确实能把 bot 送下去拿圆石)', () => {
    const after = { ...LIVE_INV, crafting_table: 1 };
    assert.equal(undergroundKitGate({ picks: 3, durablePick: false, counts: after }).sufficientForUnderground, true);
});

test('T-0060: 部分造补不回下矿门 (单木镐无圆石) → 不提, 不白耗木', () => {
    const inv = { wooden_pickaxe: 1, oak_log: 8 };
    assert.deepEqual(toolUpkeepPlan({ picks: 1, pickTier: 'wood', counts: inv, woodUnits: woodOf(inv) }).wants, []);
    const bot = fakeBot(inv);
    const w = dayWorld({ picks: 1, pickTier: 'wood', sufficientForUnderground: false });
    assert.equal(proposeTasks(w, bot).find(p => p.kind === 'TOOL_UPKEEP'), undefined);
});

test('T-0060: 全套造得起时行为不变 (台+棍+石镐一起造)', () => {
    const inv = { wooden_pickaxe: 1, oak_log: 4, cobblestone: 5 };
    const { wants, partial } = toolUpkeepPlan({ picks: 1, pickTier: 'wood', counts: inv, woodUnits: woodOf(inv) });
    assert.equal(partial, false);
    assert.deepEqual(wants.map(w => w[0]), ['crafting_table', 'stick', 'stone_pickaxe']);
});
