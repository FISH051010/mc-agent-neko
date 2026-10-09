// T-0167: 21:03:01-21:03:04Z y56 封闭地下 (FREE/ENC), 猪在 44 格外地面 — 安全寻路 0s 无路, "approached pig → 44.4b"
// 照样出手, "hunt yielded no meat" ×3 → FOOD_FLOOR 冷却 5min (food 8)。接近没缩短距离且人在地下 → 先上浮再接近一次。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-ug-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
const { default: quickMeal } = await import('../bots/_supervisor/skills/quickMeal.js');

const V = (x, y, z) => ({ x, y, z, clone() { return V(this.x, this.y, this.z); }, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });

function rig({ startY }) {
    const calls = [], gotos = [];
    const pig = { name: 'pig', position: V(0, 64, 44), isValid: true };
    const bot = { food: 8, health: 14, entity: { position: V(0, startY, 0) }, entities: { 1: pig },
        pathfinder: { stop() {}, setMovements() {},
            // 地下: 无路, 原地不动; 地面: 走到猪旁边
            goto: async () => { gotos.push(bot.entity.position.y); if (bot.entity.position.y >= 62) bot.entity.position = V(0, 64, 42.5); } },
        clearControlStates() {} };
    const ctx = { world: { getInventoryCounts: () => ({ coal: 21 }) },
        skills: { customSkill: async (_b, name) => { calls.push(name); if (name === 'surfaceUp') bot.entity.position = V(0, 63, 2); },
                  attackEntity: async () => { calls.push('attack'); }, pickupNearbyItems: async () => {}, consume: async () => {} } };
    return { bot, ctx, calls, gotos };
}

test('T-0167: 地下接近 0 进展 → 先上浮再接近一次; 上浮算进度 (不计 strike)', async () => {
    const { bot, ctx, calls, gotos } = rig({ startY: 56 });
    const r = await quickMeal(bot, ctx, { radius: 48, maxDy: 10, maxMs: 60000 });
    assert.ok(calls.includes('surfaceUp'), `surfaced (calls=${calls})`);
    assert.equal(gotos.length, 2, 'approach retried after surfacing');
    assert.ok(bot.entity.position.distanceTo({ x: 0, y: 64, z: 44 }) < 3, 'actually reached the pig');
    assert.notEqual(r.failed, true, JSON.stringify(r));
});

test('T-0167: 地面接近有进展 → 不上浮', async () => {
    const { bot, ctx, calls } = rig({ startY: 64 });
    await quickMeal(bot, ctx, { radius: 48, maxDy: 10, maxMs: 60000 });
    assert.ok(!calls.includes('surfaceUp'));
});
