// T-0217 (监工, 2026-10-10 03:21Z): 零镐 + food 0 + 地下 POCKET (109,42,-66), TOOL_UPKEEP@94.5 清单 stone_pickaxe×2 (+石剑) 占着身体,
// hp 掉到 0 才轮到 FOOD_FLOOR。饿着时一把石镐就够挖穿上浮 → 清单只补 1 把; 补到 1 把即放手 (isGoalDone), 有镐饿着不再提 (防空转派发)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starve-upkeep-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { starvingUpkeepTrim } = await import('../src/agent/framework/kit_gate.js');
const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const INV = { cobblestone: 324, stick: 1, spruce_log: 4, dirt: 65 };
function setup({ picks, food, inv = INV }) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks, pickTier: picks ? 'stone' : 'none', sufficientForUnderground: false };
    w.vitals = { ...w.vitals, hp: 4, food };
    const bot = { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
        game: { dimension: 'overworld' }, entity: { position: { x: 109, y: 42, z: -66 } }, health: 4, food };
    return { w, bot };
}
const pick = (p) => (p.args[0].find(([n]) => n === 'stone_pickaxe') || [])[1] || 0;

test('T-0217: 削单 — 石镐只留 1 把、不带石剑, 台/棍/木板照旧', () => {
    assert.deepEqual(starvingUpkeepTrim([['spruce_planks', 3], ['crafting_table', 1], ['stick', 1], ['stone_pickaxe', 2], ['stone_sword', 1]]),
        [['spruce_planks', 3], ['crafting_table', 1], ['stick', 1], ['stone_pickaxe', 1]]);
});

test('T-0217: 零镐 + food 0 → TOOL_UPKEEP 清单只 1 把石镐无剑; 吃饱时照旧 2 把', () => {
    const a = setup({ picks: 0, food: 0 });
    const p = proposeTasks(a.w, a.bot).find(x => x.kind === 'TOOL_UPKEEP');
    assert.ok(p, 'still proposed (pickless, can craft)');
    assert.equal(pick(p), 1, JSON.stringify(p.args));
    assert.ok(!p.args[0].some(([n]) => n === 'stone_sword'));
    const b = setup({ picks: 0, food: 18 });
    const q = proposeTasks(b.w, b.bot).find(x => x.kind === 'TOOL_UPKEEP');
    assert.equal(pick(q), 2, JSON.stringify(q.args));
});

test('T-0217: 补出 1 把镐后饿着 → isGoalDone 放手且不再提 TOOL_UPKEEP (防空转); 吃饱后恢复补镐', () => {
    const inv1 = { ...INV, stone_pickaxe: 1, crafting_table: 1, stick: 3 };
    const a = setup({ picks: 1, food: 0, inv: inv1 });
    assert.equal(isGoalDone('TOOL_UPKEEP', a.w, a.bot), true);
    assert.ok(!proposeTasks(a.w, a.bot).some(x => x.kind === 'TOOL_UPKEEP'));
    const b = setup({ picks: 1, food: 18, inv: inv1 });
    assert.equal(isGoalDone('TOOL_UPKEEP', b.w, b.bot), false);
    assert.ok(proposeTasks(b.w, b.bot).some(x => x.kind === 'TOOL_UPKEEP'));
});
