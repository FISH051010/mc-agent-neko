// T-0253 (2026-10-11 03:49-03:50Z): 熔完 15 块造胸甲/腿甲后只剩 1 粗铁 (铁镐 03:16 死亡掉了), 承诺仍拿旧参数 smeltSafe(raw_iron,5);
// smeltItem 要求持有≥num → 'not enough' 一块不熔; NIGHT_SMELT_IRON 完成判据要粗铁清零才放手 → 空转 ×3 冷却。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nsnoop-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);
const { default: smeltSafe } = await import('../bots/_supervisor/skills/smeltSafe.js');
const { isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

test('T-0253: smeltSafe 请求数 > 持有数 → 按持有数熔 (不再 smeltItem not-enough 一块不熔)', async () => {
    const FURNACE = { name: 'furnace', position: { x: 0, y: 64, z: 0 } };
    const inv = { raw_iron: 1, coal: 19, cobblestone: 300 };
    const asked = [];
    const bot = { entity: { position: { x: 1, y: 64, z: 0, offset() { return this; } } }, blockAt: () => FURNACE };
    const ctx = { log: () => {}, world: { getNearestBlock: () => FURNACE, getInventoryCounts: () => ({ ...inv }) },
        skills: { smeltItem: async (_b, item, n) => { asked.push(n); if ((inv[item] || 0) < n) return false; inv[item] -= n; inv.iron_ingot = (inv.iron_ingot || 0) + n; return true; },
                  clearNearestFurnace: async () => true, collectBlock: async () => true, goToPosition: async () => {} } };
    const r = await smeltSafe(bot, ctx, 'raw_iron', 5);
    assert.deepEqual(asked, [1], 'clamped to what is held');
    assert.equal(r, true);
    assert.equal(inv.iron_ingot, 1);
});

test('T-0253: 无铁镐时 NIGHT_SMELT_IRON 完成判据 — 锭+粗铁凑不够 3 也放手 (同提案门); 够 3 继续', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD)); w.kit = { ...w.kit, picks: 2, pickTier: 'stone' };
    const bot = (inv) => ({ inventory: { items: () => Object.entries(inv).map(([name, count]) => ({ name, count })), slots: [] } });
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot({ raw_iron: 1, coal: 19 })), true, '1 raw iron cannot become a pick');
    assert.equal(isGoalDone('NIGHT_SMELT_IRON', w, bot({ raw_iron: 2, iron_ingot: 1, coal: 19 })), false, '2 raw + 1 ingot = 3 → keep smelting');
});
