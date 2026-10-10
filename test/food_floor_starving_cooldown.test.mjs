// T-0201 (监工加急, death #14 01:06Z): hp 8 food 0, FOOD_FLOOR 因侦察被打断 3 连败 → 派发冷却 5min → kernel 退到 replenishKit 空转。
// 饿到 food=0 时觅食是续命: 冷却钳到 ≤30s (同下界主 kind 钳制: 有间隔不热转, 但不干等 5 分钟)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ffcd-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;
const { proposeTasks, STARVING_FOOD_FLOOR_COOLDOWN_MS } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

function run(food) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.vitals = { ...w.vitals, hp: 8, food };
    const now = Date.now();
    const bot = { inventory: { items: () => [], slots: [] }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, health: 8, food,
        _kindCooldownUntil: { FOOD_FLOOR: now + 300000, GO_UNDERGROUND: now + 300000 } };
    proposeTasks(w, bot);
    return { left: bot._kindCooldownUntil.FOOD_FLOOR - now, other: bot._kindCooldownUntil.GO_UNDERGROUND - now };
}

test('T-0201: food=0 → FOOD_FLOOR 冷却钳到 ≤30s; 别的 kind 不受影响', () => {
    const r = run(0);
    assert.ok(r.left <= STARVING_FOOD_FLOOR_COOLDOWN_MS + 50, `FOOD_FLOOR cooldown ${r.left}ms`);
    assert.ok(r.other > 250000, 'GO_UNDERGROUND cooldown untouched');
});

test('T-0201: food>0 → FOOD_FLOOR 冷却照旧 5min', () => {
    assert.ok(run(4).left > 250000);
});
