// T-0188 (监工): 07:15 hp=11 food=11 包里零食物不回血 — FOOD_FLOOR 无状态触发 hp<10 && food<18, 仲裁器 eatFloor hp≤12 && food<18,
// hp 10-12 一段两边口径不一: 不去猎, 卡 11 血直到 food 掉到 6。统一常量 REGEN_HP_MAX=12 + cannotRegen(), 三处同源。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { updateFoodFloorLatch, cannotRegen, REGEN_HP_MAX, FOOD_FLOOR } = await import('../src/agent/framework/food_floor.js');
const { eatFloor } = await import('../src/agent/framework/arbiter.js');
const { pickAutoEatFood } = await import('../src/agent/framework/healing_reflex.js');

test('T-0188: hp 11 food 11 零食物 → FOOD_FLOOR 会话开启 (07:15 实录)', () => {
    const L = updateFoodFloorLatch(null, { food: 11, counts: {}, animalNear: false, hp: 11 });
    assert.equal(L.active, true);
    assert.equal(updateFoodFloorLatch(null, { food: 11, counts: {}, animalNear: false, hp: 13 }).active, false, 'hp 13 not gated');
});

test('T-0188: 三处判据同源 — FOOD_FLOOR 会话 / eatFloor / 应急挑食在 hp 1-20 × food 0-20 全网格上一致', () => {
    const WS = { name: 'ws:*', kind: 'skill' }, EAT = { name: 'mode:auto_eat', kind: 'mode' };
    for (let hp = 1; hp <= 20; hp++) for (let food = 0; food <= 20; food++) {
        const want = food <= FOOD_FLOOR || (hp <= REGEN_HP_MAX && food < 18);
        assert.equal(food <= FOOD_FLOOR || cannotRegen(hp, food), want);
        assert.equal(updateFoodFloorLatch(null, { food, counts: {}, animalNear: false, hp }).active, want, `latch hp${hp} food${food}`);
        assert.equal(eatFloor({ health: hp, food }, WS, EAT), want, `eatFloor hp${hp} food${food}`);
        assert.equal(!!pickAutoEatFood([{ name: 'rotten_flesh' }], { health: hp, food }), want, `pickAutoEatFood hp${hp} food${food}`);
    }
});

test('T-0188: 源码不再有硬编码的 hp<=12 / food<=6 回血判据', () => {
    for (const f of ['../src/agent/framework/arbiter.js', '../src/agent/framework/healing_reflex.js']) {
        const s = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
        assert.ok(!/hp <= 12|health <= 12/.test(s), `${f} uses cannotRegen()`);
    }
});

test('T-0188 补: 回不了血 (hp11 food11) 零可吃 地下零动物 → 提案带 surfaceFirst+scout; 满血 food11 不为存粮侦察; 包里有吃的不侦察', async () => {
    const { foodFloorProposal } = await import('../src/agent/framework/food_floor.js');
    const base = { foodInstincts: false, overworld: true, phase: 'day', food: 11, actionable: 0, counts: { stone_pickaxe: 2 }, animal: null, botY: 49, depthBand: 'shallow', latch: { active: true, kills: 0 } };
    const p = foodFloorProposal({ ...base, hp: 11 });
    assert.ok(p && p.args[0].surfaceFirst && p.args[0].scout, JSON.stringify(p && p.args[0]));
    assert.equal(foodFloorProposal({ ...base, hp: 20 }), null, 'full hp, food 11 → no stock-up scouting');
    assert.equal(foodFloorProposal({ ...base, hp: 11, counts: { bread: 2 } }), null, 'has food → auto_eat eats, no hunt');
});
