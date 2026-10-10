// T-0210 (监工): 10:21-10:26 白天 food 一直 8-9, 卡在 GET_BED 门 (food≥10) 与 FOOD_FLOOR 门 (food≤6) 之间两件都不做,
// 挖到黄昏才掉到 6 → FOOD_FLOOR 只在白天, 饿着过夜。两个新触发 (会话补到 18, 允许侦察): ①入夜前 tod 9000-12000 且 food<14;
// ②床待做 (石器+剑+没床) 且 food<10 — 先补餐再找羊。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
delete process.env.MC_FOOD_INSTINCTS;

const { latchTrigger, updateFoodFloorLatch } = await import('../src/agent/framework/food_floor.js');
const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

test('T-0210: 触发原因 — food≤6 starving / 回不了血 regen / 黄昏前 food<14 dusk / 床待做 food<10 bed; 其余不触发', () => {
    assert.equal(latchTrigger({ food: 5, hp: 20, tod: 3000 }), 'starving');
    assert.equal(latchTrigger({ food: 12, hp: 10, tod: 3000 }), 'regen');
    assert.equal(latchTrigger({ food: 12, hp: 20, tod: 10000 }), 'dusk');
    assert.equal(latchTrigger({ food: 15, hp: 20, tod: 10000 }), null, 'food 15 ≥14 → no dusk meal');
    assert.equal(latchTrigger({ food: 9, hp: 20, tod: 3000, bedPending: true }), 'bed');
    assert.equal(latchTrigger({ food: 9, hp: 20, tod: 3000, bedPending: false }), null, '10:21 live gap without bed pending stays (no stock-up scouting)');
    const L = updateFoodFloorLatch(null, { food: 12, hp: 20, tod: 10500, counts: {}, animalNear: false });
    assert.equal(L.active, true); assert.equal(L.reason, 'dusk');
});

function mk({ tod, food, sword }) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { tod, phase: 'day', isDay: true };
    w.kit = { ...w.kit, picks: 2, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food };
    const inv = { stone_pickaxe: 2, cobblestone: 40, crafting_table: 1, ...(sword ? { stone_sword: 1 } : {}) };
    const bot = { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] }, game: { dimension: 'overworld' },
        entity: { position: { x: 0, y: 70, z: 0 } }, entities: {}, health: 20, food, blockAt: () => ({ skyLight: 15 }) };
    return proposeTasks(w, bot);
}

test('T-0210: 床待做 + food 9 (白天) → FOOD_FLOOR 侦察觅食 (先补餐), 不再两个都不做', () => {
    const ps = mk({ tod: 3000, food: 9, sword: true });
    const ff = ps.find(p => p.kind === 'FOOD_FLOOR');
    assert.ok(ff && ff.args[0].scout, JSON.stringify(ps.map(p => p.kind)));
});

test('T-0210: 黄昏前 (tod 10000) food 12 → FOOD_FLOOR 补餐; 同 food 白天中段 (tod 3000) 且无床待做 → 不提', () => {
    assert.ok(mk({ tod: 10000, food: 12, sword: false }).some(p => p.kind === 'FOOD_FLOOR'));
    assert.ok(!mk({ tod: 3000, food: 12, sword: false }).some(p => p.kind === 'FOOD_FLOOR'));
});
