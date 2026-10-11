// T-0259 (监工, 2026-10-11 04:16:32-04:21Z): 零镐 REPLENISH_KIT 3 连败冷却 5min, 其余提案零镐时全被门挡 → 白天 4 分多钟零派发原地发呆。
// 零镐时补镐/开局链是一阶续命: 冷却同 T-0201 手法钳到 ≤45s; 有镐时照旧 5min。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pkcd-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;
const { proposeTasks, PICKLESS_KIT_COOLDOWN_MS, PICKLESS_KIT_KINDS } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

function run(inv) {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.vitals = { ...w.vitals, hp: 20, food: 17 };
    const now = Date.now();
    const cd = { GO_UNDERGROUND: now + 300000 }; for (const k of PICKLESS_KIT_KINDS) cd[k] = now + 300000;
    const bot = { inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] }, game: { dimension: 'overworld' },
        entity: { position: { x: 28, y: 66, z: -10 } }, health: 20, food: 17, _kindCooldownUntil: cd };
    proposeTasks(w, bot);
    return Object.fromEntries(Object.entries(bot._kindCooldownUntil).map(([k, v]) => [k, v - now]));
}

test('T-0259: 零镐 → REPLENISH_KIT / TOOL_UPKEEP / BOOTSTRAP_KIT / SURFACE_RESCUE 冷却钳到 ≤45s; 别的 kind 不动', () => {
    const r = run({ stick: 4, spruce_planks: 2, crafting_table: 1 });
    for (const k of PICKLESS_KIT_KINDS) assert.ok(r[k] <= PICKLESS_KIT_COOLDOWN_MS + 50, `${k} ${r[k]}ms`);
    assert.ok(r.GO_UNDERGROUND > 250000, 'unrelated kind untouched');
});

test('T-0259: 有镐 → 冷却照旧 5min', () => {
    const r = run({ stone_pickaxe: 1, stick: 4 });
    assert.ok(r.REPLENISH_KIT > 250000);
});
