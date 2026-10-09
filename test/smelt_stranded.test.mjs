// T-0164 (20:40:57Z 实录): smeltSafe(raw_iron x8) "done. consumed=8" 但背包 0 铁锭 — 输入差把"料进了炉"记成成功,
// 8 铁滞留 -54,22,24 炉里, bot 走开。修: 按产物记进度; 炉边收尾 (清炉+收炉); 收不回落盘 → RECLAIM_FURNACE 回炉取。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stranded-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.env.MC_AGENT_HOME = home;
process.chdir(home);   // smeltSafe 按 cwd 写 progress.txt / stranded_smelt.json

const { default: smeltSafe, smeltLedger, readStranded, writeStranded } = await import('../bots/_supervisor/skills/smeltSafe.js');
const { proposeTasks, isGoalDone } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

const FURNACE = { name: 'furnace', position: { x: -54, y: 22, z: 24 } };
function rig({ clearYields = 0 } = {}) {
    const inv = { raw_iron: 11, coal: 22, cobblestone: 363 };
    const calls = [];
    const bot = { entity: { position: { x: -50, y: 22, z: 24, offset() { return this; } } }, blockAt: () => FURNACE };
    const world = { getNearestBlock: () => FURNACE, getInventoryCounts: () => ({ ...inv }) };
    const skills = {
        // live: 输入进了炉, 窗口丢 → stale 放弃, 一块锭都没收到
        smeltItem: async (b, item, n) => { inv.raw_iron -= n; calls.push('smeltItem'); return false; },
        clearNearestFurnace: async () => { calls.push('clear'); if (clearYields) inv.iron_ingot = (inv.iron_ingot || 0) + clearYields; return true; },
        collectBlock: async () => { calls.push('collect'); inv.furnace = (inv.furnace || 0) + 1; return true; },
        goToPosition: async () => { calls.push('goto'); },
    };
    return { bot, ctx: { skills, world, log: () => {} }, inv, calls };
}

test('T-0164: smeltLedger — 料进了炉没出锭 ≠ 进度 (consumed=8 produced=0 → stranded 8)', () => {
    const L = smeltLedger('raw_iron', { raw_iron: 11 }, { raw_iron: 3 });
    assert.equal(L.progressed, false);
    assert.equal(L.stranded, 8);
    assert.equal(smeltLedger('raw_iron', { raw_iron: 11 }, { raw_iron: 3, iron_ingot: 8 }).progressed, true);
});

test('T-0164: 20:40:57 复现 — 收不回锭 → 报 false 并落盘滞留记录; 能收回 → 炉边清炉拿到 8 锭 + 收炉, 报 true', async () => {
    writeStranded(null);
    const a = rig({ clearYields: 0 });
    assert.equal(await smeltSafe(a.bot, a.ctx, 'raw_iron', 8), false, 'no ingot reached the bag → not success');
    const rec = readStranded();
    assert.ok(rec && rec.n === 8 && rec.x === -54 && rec.product === 'iron_ingot', JSON.stringify(rec));

    writeStranded(null);
    const b = rig({ clearYields: 8 });
    assert.equal(await smeltSafe(b.bot, b.ctx, 'raw_iron', 8), true);
    assert.equal(b.inv.iron_ingot, 8);
    assert.ok(b.calls.includes('collect'), 'carried furnace picked back up');
    assert.equal(readStranded(), null, 'nothing stranded');
});

test('T-0164: 两口滞留炉 (-55,21,23 ×8 + -53,22,49 料数未知) → reclaimFurnace 由近及远都收, 空炉也挖回, 记录清空', async () => {
    writeStranded(null);
    writeStranded({ x: -55, y: 21, z: 23, item: 'raw_iron', product: 'iron_ingot', n: 8, at: Date.now() });
    writeStranded({ x: -53, y: 22, z: 49, item: 'raw_iron', product: 'iron_ingot', n: null, at: Date.now() });
    const { readAllStranded } = await import('../bots/_supervisor/skills/smeltSafe.js');
    assert.equal(readAllStranded().length, 2);
    const { default: reclaimFurnace } = await import('../bots/_supervisor/skills/reclaimFurnace.js');
    const inv = {}; const visits = [];
    let pos = { x: -43, y: 63, z: 25 };
    const bot = { entity: { get position() { return { ...pos, offset(dx, dy, dz) { return { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }; } }; } },
                  blockAt: () => ({ name: 'furnace' }) };
    let first = true;
    const skills = {
        goToPosition: async (b, x, y, z) => { pos = { x, y, z }; visits.push(`${x},${y},${z}`); },
        clearNearestFurnace: async () => { if (first) { inv.iron_ingot = (inv.iron_ingot || 0) + 8; first = false; } return true; },   // 第二口是空炉
        collectBlock: async () => { inv.furnace = (inv.furnace || 0) + 1; return true; },
    };
    const ok = await reclaimFurnace(bot, { skills, world: { getInventoryCounts: () => ({ ...inv }) }, log: () => {} });
    assert.equal(ok, true);
    assert.deepEqual(visits, ['-55,21,23', '-53,22,49'], 'nearest first, then the second within 64b');
    assert.equal(inv.iron_ingot, 8);
    assert.equal(inv.furnace, 2, 'empty furnace still picked up (furnace is an asset)');
    assert.equal(readAllStranded().length, 0);
});

test('T-0164: 滞留记录 ≤64 格 → 提 RECLAIM_FURNACE(reclaimFurnace); 收回后 isGoalDone; 太远不提', () => {
    writeStranded({ x: -54, y: 22, z: 24, item: 'raw_iron', product: 'iron_ingot', n: 8, at: Date.now() });
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    w.time = { ...w.time, phase: 'day', isDay: true };
    w.pos = { x: -39, y: 62, z: 22, depthBand: 'surface' };   // 04:44 live
    const bot = { inventory: { items: () => [{ name: 'wooden_pickaxe', count: 2 }], slots: [] }, game: { dimension: 'overworld' }, entity: { position: w.pos }, health: 14, food: 13 };
    const p = proposeTasks(w, bot).find(x => x.kind === 'RECLAIM_FURNACE');
    assert.ok(p && p.skill === 'reclaimFurnace', 'proposed');
    assert.equal(isGoalDone('RECLAIM_FURNACE', w, bot), false);
    const far = { ...w, pos: { x: 100, y: 62, z: 22, depthBand: 'surface' } };
    assert.ok(!proposeTasks(far, bot).some(x => x.kind === 'RECLAIM_FURNACE'));
    // 21:03:29 实录迟滞: 72 格 (bot 漂到 12,51,46) 仍提; 走路绕到 110 格不释放; 130 格才释放
    const at72 = { ...w, pos: { x: 12, y: 51, z: 46, depthBand: 'mid' } };
    assert.ok(proposeTasks(at72, bot).some(x => x.kind === 'RECLAIM_FURNACE'), '72b → still proposed');
    assert.equal(isGoalDone('RECLAIM_FURNACE', { ...w, pos: { x: 50, y: 21, z: 23 } }, bot), false, '105b mid-walk → keep commitment');
    assert.equal(isGoalDone('RECLAIM_FURNACE', { ...w, pos: { x: 80, y: 21, z: 23 } }, bot), true, '135b → release');
    writeStranded(null);
    assert.equal(isGoalDone('RECLAIM_FURNACE', w, bot), true);
});
