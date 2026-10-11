// T-0245 顺路补粮 (监工 10-11 03:04-03:06Z: 又掉到 hp1 food0)。
// ① food 6 才出发找吃的、包里零食物 → 上浮+侦察 ~4min 吃到 0 → 饥饿 70s 把 hp 18 打到 1: 包里零可吃且 food≤12 且附近已看见动物 → 开会话顺路猎 (不侦察)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-gate-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
const { latchTrigger, updateFoodFloorLatch, foodFloorProposal, STOCK_FOOD } = await import('../src/agent/framework/food_floor.js');
const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, offset(dx, dy, dz) { return V(this.x + dx, this.y + dy, this.z + dz); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });

test('T-0245: 包里零可吃 + food≤12 + 附近已看见动物 → stock 会话; 有熟食/看不见动物/food 13 → 不触发', () => {
    assert.equal(STOCK_FOOD, 12);
    assert.equal(latchTrigger({ food: 12, hp: 20, counts: {}, animalNear: true }), 'stock');
    assert.equal(latchTrigger({ food: 12, hp: 20, counts: { cooked_beef: 1 }, animalNear: true }), null);
    assert.equal(latchTrigger({ food: 12, hp: 20, counts: {}, animalNear: false }), null, 'no scouting for stock');
    assert.equal(latchTrigger({ food: 13, hp: 20, counts: {}, animalNear: true }), null);
    assert.equal(updateFoodFloorLatch(null, { food: 10, hp: 20, counts: {}, animalNear: true }).reason, 'stock');
});

test('T-0245: stock 会话 + 动物在猎程 → FOOD_FLOOR 一次短猎, 不带侦察/上浮', () => {
    const p = foodFloorProposal({ foodInstincts: false, overworld: true, phase: 'day', food: 10, hp: 20, actionable: 0, counts: {},
        animal: { dist: 20, x: 20, y: 70, z: 0, age: 1000, meta: 'cow' }, botY: 70, botPos: { x: 0, y: 70, z: 0 }, depthBand: 'surface', skyOpen: true,
        latch: { active: true, kills: 0, reason: 'stock' } });
    assert.ok(p, 'proposed');
    assert.ok(!p.args[0].scout && !p.args[0].surfaceFirst, JSON.stringify(p.args));
});

