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
    assert.deepEqual(tu.args[0], [['spruce_planks', 1], ['crafting_table', 1]], 'fold logs→planks, then the table; no stone pick without cobble');
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
    assert.deepEqual(wants.map(w => w[0]), ['oak_planks', 'crafting_table', 'stick', 'stone_pickaxe']);
});

test('T-0060: 只揣原木 0 板 → 清单首步必须折够板 (craftChain 只折清单里列出的板; 16:23 实录 3 连败→冷却)', () => {
    const inv = { wooden_pickaxe: 3, spruce_log: 11, stick: 2 };   // 16:23 live
    const { wants } = toolUpkeepPlan({ picks: 3, pickTier: 'wood', counts: inv, woodUnits: woodOf(inv) });
    assert.deepEqual(wants, [['spruce_planks', 2], ['crafting_table', 1], ['stick', 1]], '4 (table) + 2 (sticks) = 6 planks = 2 folds');
});

test('T-0118 回归: 石镐磨光掉回木器, 揣 97 圆石 + 2 木镐 + 原木 (下矿门因能补镐仍开) → 必须提 TOOL_UPKEEP 造 2 把石镐, 且压过 GO_UNDERGROUND', () => {
    const inv = { wooden_pickaxe: 2, cobblestone: 97, diorite: 32, coal: 13, spruce_log: 9, spruce_planks: 2, stick: 4 };   // 16:40 live
    const bot = fakeBot(inv);
    const w = dayWorld({ picks: 2, pickTier: 'wood', sufficientForUnderground: true });
    const props = proposeTasks(w, bot);
    const tu = props.find(p => p.kind === 'TOOL_UPKEEP');
    assert.ok(tu, 'TOOL_UPKEEP proposed even though the descent gate is open');
    assert.deepEqual(tu.args[0].find(([n]) => n === 'stone_pickaxe'), ['stone_pickaxe', 2]);
    const gu = props.find(p => p.kind === 'GO_UNDERGROUND');
    assert.ok(!gu || tu.priority > gu.priority, 'upgrade before descending further');
    assert.equal(isGoalDone('TOOL_UPKEEP', w, bot), false);
    const stoneW = dayWorld({ picks: 2, pickTier: 'stone', sufficientForUnderground: true });
    assert.equal(proposeTasks(stoneW, fakeBot({ ...inv, stone_pickaxe: 2 })).find(p => p.kind === 'TOOL_UPKEEP'), undefined, 'stone tier + gate open → no upkeep');
});

test('T-0130: 铁镐×3 + 0 石镐 + 圆石 545 + 棍 27 (下矿门开) → 必须提 TOOL_UPKEEP 造 1 把护航石镐; 已有石镐则不提', () => {
    const inv = { iron_pickaxe: 3, cobblestone: 545, stick: 27, spruce_log: 19, spruce_planks: 8 };   // 02:26 live (worker-stuck)
    const w = dayWorld({ picks: 3, pickTier: 'iron', sufficientForUnderground: true });
    w.vitals = { ...w.vitals, hp: 20, food: 20 };
    const tu = proposeTasks(w, fakeBot(inv)).find(p => p.kind === 'TOOL_UPKEEP');
    assert.ok(tu, 'escort stone pick upkeep proposed');
    assert.deepEqual(tu.args[0].find(([n]) => n === 'stone_pickaxe'), ['stone_pickaxe', 1]);
    assert.equal(isGoalDone('TOOL_UPKEEP', w, fakeBot(inv)), false);
    assert.equal(isGoalDone('TOOL_UPKEEP', w, fakeBot({ ...inv, stone_pickaxe: 1, crafting_table: 1 })), true, 'done once an escort exists');
    assert.equal(proposeTasks(w, fakeBot({ ...inv, stone_pickaxe: 1, crafting_table: 1 })).find(p => p.kind === 'TOOL_UPKEEP'), undefined);
});

test('T-0149: y19 地下零镐 + 圆石/原木/棍 (19:35 现场) → TOOL_UPKEEP 原地造石镐 @94.5, 抢下已粘住的夜挖承诺', async () => {
    const { commitGoal, PICKLESS_UPKEEP_PRIORITY } = await import('../src/agent/framework/world_model.js');
    const inv = { cobblestone: 217, spruce_log: 14, stick: 2, spruce_planks: 2, birch_log: 2, raw_iron: 1 };
    const w = dayWorld({ picks: 0, pickTier: 'none', sufficientForUnderground: false });
    w.time = { ...w.time, phase: 'night', isDay: false };
    const props = proposeTasks(w, fakeBot(inv));
    const tu = props.find(p => p.kind === 'TOOL_UPKEEP');
    assert.ok(tu, 'pickless upkeep proposed');
    assert.equal(tu.priority, PICKLESS_UPKEEP_PRIORITY);
    assert.ok(tu.args[0].some(([n]) => n === 'stone_pickaxe'));
    const bot = fakeBot(inv);
    bot._commitment = { kind: 'DUSK_MINE_NIGHT', skill: 'mineDown', since: Date.now() - 60000 };
    const night = { kind: 'DUSK_MINE_NIGHT', priority: 94, skill: 'mineDown' };
    const c = commitGoal(bot, [night, tu], w);
    assert.equal(c.kind, 'TOOL_UPKEEP', `sticky night commitment must yield to pickless upkeep (got ${c.kind})`);
});

test('T-0149: 零镐但没有圆石 → 不提 (造不出石镐就不抢夜链)', () => {
    const w = dayWorld({ picks: 0, pickTier: 'none', sufficientForUnderground: false });
    assert.equal(proposeTasks(w, fakeBot({ spruce_log: 14, stick: 2 })).find(p => p.kind === 'TOOL_UPKEEP'), undefined);
});
