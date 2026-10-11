// T-0227 (提案↔技能判据不同源): GET_PORTAL_KIT 60min 内被 dispatch-cooldown 3 次 (10-10 18:36-19:37Z), 每次 gatherObsidian 1.5s 秒败、无日志。
// 机理: 提案侧 portalIronOk = ironForArmor (锭 + 粗铁 1:1) ≥ 桶3+打火石1; 技能合成桶/打火石只认 iron_ingot 且从不熔炼 →
// 只有粗铁时 'kit prereq missing' 秒败 ×3。修: 技能入口锭不够先熔粗铁; 提案侧铁 = 锭 + min(粗铁, 燃料可熔量); ABORT 原因写进 progress。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'portalkit-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
process.env.MC_FOOD_INSTINCTS = '0';
const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');
const { default: gatherObsidian } = await import('../bots/_supervisor/skills/gatherObsidian.js');

function endgame(extra) {
    const inv = { diamond_pickaxe: 1, iron_pickaxe: 1, stone_pickaxe: 2, diamond_sword: 1, shield: 1, diamond: 5, cooked_beef: 16, crafting_table: 1,
        oak_log: 20, cobblestone: 64, torch: 16, flint: 1, ...extra };
    const items = Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count }));
    const slots = []; slots[5] = { name: 'diamond_helmet' }; slots[6] = { name: 'diamond_chestplate' }; slots[7] = { name: 'diamond_leggings' }; slots[8] = { name: 'diamond_boots' }; slots[45] = { name: 'shield' };
    const bot = { inventory: { items: () => items, slots }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 70, z: 0 } }, entities: {}, health: 20, food: 20 };
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.time = { ...w.time, phase: 'day', isDay: true }; w.vitals = { ...w.vitals, hp: 20, food: 20, armor: 4 };
    w.kit = { ...w.kit, picks: 4, pickTier: 'diamond', sufficientForUnderground: true, foodSufficient: true }; w.pos = { depthBand: 'surface' }; w.surfaceGate = { mode: 'free' };
    return proposeTasks(w, bot).some(p => p.kind === 'GET_PORTAL_KIT');
}

test('T-0227: 提案侧铁 = 锭 + min(粗铁, 燃料可熔量) — 只有粗铁且无燃料不提, 有煤或有锭才提', () => {
    assert.equal(endgame({ raw_iron: 4, oak_log: 0 }), false, 'raw iron with no fuel cannot become a bucket');
    assert.equal(endgame({ raw_iron: 4, coal: 4 }), true);
    assert.equal(endgame({ iron_ingot: 4 }), true);
});

test('T-0227: gatherObsidian 入口锭不够 → 先 smeltSafe 熔粗铁 (不再 1.5s kit prereq missing 秒败); 放弃原因写进 progress', async () => {
    const inv = { diamond_pickaxe: 1, raw_iron: 3, flint_and_steel: 1, coal: 4 };
    const calls = [];
    const bot = { game: { dimension: 'overworld' }, inventory: { items: () => Object.entries(inv).filter(([, c]) => c > 0).map(([name, count]) => ({ name, count })) },
        entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, blockAt: () => null };
    const ctx = { log: () => {}, Vec3: null, world: { getInventoryCounts: () => ({ ...inv }), getNearestBlock: () => null, getNearestBlockAsync: async () => null, getNearestBlocksWhereAsync: async () => [] },
        skills: { customSkill: async (_b, name, item, n) => { calls.push([name, item, n]); if (name === 'smeltSafe') { inv.raw_iron -= n; inv.iron_ingot = (inv.iron_ingot || 0) + n; } },
                  craftRecipe: async (_b, name) => { calls.push(['craft', name]); }, moveAway: async () => {}, useToolOn: async () => {}, goToPosition: async () => {} } };
    await gatherObsidian(bot, ctx, { obsidianTarget: 14, maxMs: 2000 });
    assert.deepEqual(calls[0], ['smeltSafe', 'raw_iron', 3], JSON.stringify(calls));
    assert.ok(calls.some(c => c[0] === 'craft' && c[1] === 'bucket'), 'bucket crafted from the smelted ingots');
    assert.match(fs.readFileSync(path.join(home, 'bots', '_supervisor', 'progress.txt'), 'utf8'), /gatherObsidian/);
});
