// T-0255 (监工拍板 (a), 2026-10-11 03:59:46Z 死亡 — 饥饿磨血 + 僵尸补刀): 带着 food 2、零食物进夜, Normal 饥饿把 hp 从 18 磨到 2,
// 天亮出门被僵尸补刀。修: 'dusk' 锁存 (T-0210 入夜前补餐) 在零可吃时放宽到 food<18 — 黄昏前最后一个窗口吃饱再进夜。
import test from 'node:test';
import assert from 'node:assert/strict';
const { latchTrigger, foodFloorProposal, PRE_DUSK_TOD_LO, FOOD_RELEASE } = await import('../src/agent/framework/food_floor.js');

test('T-0255: 黄昏前窗口零可吃 → food<18 就开 dusk 会话; 有吃的维持旧线 (<14); 窗口外不触发', () => {
    const tod = PRE_DUSK_TOD_LO + 500;
    assert.equal(latchTrigger({ food: 16, hp: 20, tod, counts: {}, animalNear: false }), 'dusk');
    assert.equal(latchTrigger({ food: FOOD_RELEASE - 1, hp: 20, tod, counts: {}, animalNear: false }), 'dusk');
    assert.equal(latchTrigger({ food: 16, hp: 20, tod, counts: { cooked_beef: 2 }, animalNear: false }), null, 'has food: old 14 line');
    assert.equal(latchTrigger({ food: 16, hp: 20, tod: 5000, counts: {}, animalNear: false }), null, 'outside the pre-dusk window');
});

test('T-0255: dusk 会话 + 零可吃 + 看不见动物 → FOOD_FLOOR 带侦察 (plannedMeal)', () => {
    const p = foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 16, hp: 20, actionable: 0, counts: {}, animal: null,
        botY: 70, botPos: { x: 0, y: 70, z: 0 }, depthBand: 'surface', skyOpen: true, latch: { active: true, kills: 0, reason: 'dusk' } });
    assert.ok(p && p.args[0].scout, JSON.stringify(p && p.args));
});
