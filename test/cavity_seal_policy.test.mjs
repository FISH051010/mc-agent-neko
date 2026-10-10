// T-0195 (监工拍板, death #13 00:23:44Z: 1 件甲 (铁盔) + 石剑白天下采铁, 开放洞穴 y5 被骷髅射杀): keepInventory=false 且没有胸甲档
// → 破入天然空腔一律封口换向 (不等"16 格内有敌对", 暗处随时刷骷髅); 有胸甲后恢复"有敌对才封"。决策层每拍写 bot._cavitySealAlways。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cav-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
const kf = path.join(home, 'bots', '_supervisor', 'keepinv.json');
fs.writeFileSync(kf, JSON.stringify({ value: false }));
process.env.MC_AGENT_HOME = home;

const { cavitySealAlways } = await import('../src/agent/framework/armor_gate.js');
const { proposeTasks } = await import('../src/agent/framework/world_model.js');
const { EMPTY_WORLD } = await import('../src/agent/framework/contracts.js');

test('T-0195: keepInv 关 + 无胸甲档 (0 甲 / 只有铁盔) → 一律封; 穿胸甲或护甲点≥8 → 恢复按敌对; keepInv 开/未知 → 不加', () => {
    assert.equal(cavitySealAlways([], true), true);
    assert.equal(cavitySealAlways(['iron_helmet'], true), true, 'death #13: helmet only');
    assert.equal(cavitySealAlways(['iron_chestplate'], true), false);
    assert.equal(cavitySealAlways(['iron_helmet', 'iron_leggings', 'iron_boots'], true), false, '2+5+2=9 points ≥8');
    assert.equal(cavitySealAlways([], false), false);
    assert.equal(cavitySealAlways([], null), false);
});

test('T-0195: proposeTasks 每拍写 bot._cavitySealAlways (穿戴变化即时生效)', () => {
    const w = JSON.parse(JSON.stringify(EMPTY_WORLD));
    const mk = (worn) => { const slots = []; worn.forEach((n, i) => { slots[5 + i] = { name: n }; });
        return { inventory: { items: () => [], slots }, game: { dimension: 'overworld' }, entity: { position: { x: 0, y: 5, z: 0 } } }; };
    const naked = mk(['iron_helmet']); proposeTasks(w, naked);
    assert.equal(naked._cavitySealAlways, true);
    const chest = mk(['iron_helmet', 'iron_chestplate']); proposeTasks(w, chest);
    assert.equal(chest._cavitySealAlways, false);
});
