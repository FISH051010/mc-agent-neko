// T-0150: 夜间冶炼判据燃料只数煤 → 无煤有木的 bot 永不 SMELT_IRON (实录 10-10 19:49Z: raw_iron 10 + 原木 17 + 0 煤)。
// smeltItem (mcdata.getSmeltingFuel) 本就认原木/木板 1.5 件/个 — 判据与执行端同口径。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { smeltableUnits, WOOD_FUEL_RESERVE_LOGS } from '../src/agent/framework/kit_gate.js';

test('T-0150: 19:49 现场 (原木 17, 0 煤) → 可冶炼件数 ≥3 (够一把铁镐)', () => {
    const u = smeltableUnits({ spruce_log: 17, raw_iron: 10, cobblestone: 463 });
    assert.ok(u >= 3, `units=${u}`);
    assert.equal(u, Math.floor((17 - WOOD_FUEL_RESERVE_LOGS) * 1.5));
});

test('T-0150: 只剩 2 原木 (留给棍/台) → 不算燃料; 煤照旧 8 件/个', () => {
    assert.equal(smeltableUnits({ spruce_log: 2 }), 0);
    assert.equal(smeltableUnits({ coal: 1 }), 8);
    assert.equal(smeltableUnits({ oak_planks: 2 }), 3);
});

test('T-0150: modes.js 夜间冶炼判据用 smeltableUnits (不再只数煤)', () => {
    const src = fs.readFileSync(new URL('../src/agent/modes.js', import.meta.url), 'utf8');
    const line = src.split('\n').find(l => l.includes('const _ironConvAchievable ='));
    assert.ok(line && /smeltableUnits\(counts\) >= 3/.test(line), line);
});
