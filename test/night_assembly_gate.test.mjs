// T-0177: 22:28:48-51Z 夜里 y21, 4 镐 + 1 木板 + 0 台 (+218 圆石) — 夜间口袋组装门因"缺台 + 有 1 木料"放行 →
// replenishKit 夜里跳过砍木/上浮, 1 板拍不了台 → ZERO delta ×3 → REPLENISH_KIT 冷却。铁律 2: 只在真能合成时放行。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nag-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
delete process.env.MC_FOOD_INSTINCTS;

const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const LIVE = { stone_pickaxe: 2, wooden_pickaxe: 2, stone_sword: 1, stick: 5, raw_iron: 7, cobblestone: 218, spruce_planks: 1 };
const fakeBot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] },
    game: { dimension: 'overworld' }, entity: { position: { x: -24, y: 21, z: 15 } }, health: 20, food: 18 });
function nightWorld() {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'night', isDay: false };
    w.kit = { ...w.kit, picks: 4, pickTier: 'stone', sufficientForUnderground: true };
    w.vitals = { ...w.vitals, hp: 20, food: 18 };
    w.pos = { x: -24, y: 21, z: 15, depthBand: 'mid' };
    return w;
}
const rk = (inv) => proposeTasks(nightWorld(), fakeBot(inv)).filter(p => p.kind === 'REPLENISH_KIT');

test('T-0177: 夜里缺台但只有 1 木板 → 不提 REPLENISH_KIT (replenishKit 必零进展)', () => {
    assert.equal(rk(LIVE).length, 0);
});

test('T-0177: 夜里缺镐 (2 把) + 无台但 6 木板 (能现拍台) + 圆石 + 棍 → 照常提 (夜间口袋组装真能造镐)', () => {
    assert.equal(rk({ stone_pickaxe: 2, cobblestone: 50, stick: 5, spruce_planks: 6 }).length, 1);
});

test('T-0177: 夜里缺镐 (1 把) + 圆石 + 台 + 棍 → 提; 缺镐但无台无木 → 不提', () => {
    const one = { wooden_pickaxe: 1, cobblestone: 20, stick: 4, crafting_table: 1 };
    assert.equal(rk(one).length, 1);
    assert.equal(rk({ wooden_pickaxe: 1, cobblestone: 20, stick: 4 }).length, 0);
});
