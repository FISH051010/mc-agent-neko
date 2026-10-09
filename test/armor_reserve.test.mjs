// T-0140: GET_ARMOR 提案按全部铁算, craftArmor 无铁镐时给镐预留 3 铁 → 4 粗铁时提案端以为够造靴(4), 技能端预算 1 →
// RESERVE gate 拒跑 ×3 → 冷却 (实录 10-10 19:02:03Z)。提案与技能同口径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeTasks, isGoalDone, ironArmorBudget } from '../src/agent/framework/world_model.js';
import { EMPTY_WORLD } from '../src/agent/framework/contracts.js';

const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 20, food: 20 });
function w0() { const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 3, pickTier: 'stone', sufficientForUnderground: true }; w.vitals = { ...w.vitals, armor: 0, hp: 20, food: 20 }; return w; }

test('T-0140: 无铁镐 + 4 粗铁 (19:02 现场) → 不提 GET_ARMOR (铁先给镐), 且已承诺的视为完成', () => {
    const inv = { raw_iron: 4, stone_pickaxe: 2, wooden_pickaxe: 2, cobblestone: 139, spruce_log: 10 };
    assert.equal(ironArmorBudget(fakeBot(inv)), 1);
    assert.equal(proposeTasks(w0(), fakeBot(inv)).find(p => p.kind === 'GET_ARMOR'), undefined);
    assert.equal(isGoalDone('GET_ARMOR', w0(), fakeBot(inv)), true);
});

test('T-0140: 有铁镐后无预留 → 4 铁即提 GET_ARMOR (造靴)', () => {
    const inv = { iron_ingot: 4, iron_pickaxe: 1, stone_pickaxe: 2, crafting_table: 1 };   // T-0157: 造甲要台 (无台无木 → armorCraftBlocked 正确不提)
    assert.equal(ironArmorBudget(fakeBot(inv)), 4);
    assert.ok(proposeTasks(w0(), fakeBot(inv)).find(p => p.kind === 'GET_ARMOR'));
});
