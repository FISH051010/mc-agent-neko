import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ensureCarriedTable, plankForLog } from '../src/agent/framework/ensure_table.js';

// Live 10-11 04:46:34 / 04:46:43Z (监工加急, 镐耗尽风险): mineDown 'fodder-recraft: stone_pickaxe → fail (保铁镐不碰石)' ×2 at y18
// with one wooden pick left — cobblestone 135, stick 8, birch_planks 8, birch_log 10, but NO crafting_table. craftRecipeLocal
// places and reclaims a CARRIED table; with none carried a 3x3 recipe just fails. A human makes a table from planks first.
function fakeInv(init) {
    const inv = { ...init };
    const crafted = [];
    const recipes = {
        crafting_table: { need: { planks: 4 }, out: 1 },
        birch_planks: { need: { birch_log: 1 }, out: 4 },
        oak_planks: { need: { oak_log: 1 }, out: 4 },
        crimson_planks: { need: { crimson_stem: 1 }, out: 4 },
    };
    const craftLocal = async (name, n = 1) => {
        const r = recipes[name]; if (!r) return false;
        for (let i = 0; i < n; i++) {
            for (const [k, v] of Object.entries(r.need)) {
                if (k === 'planks') {
                    const pk = Object.keys(inv).find(x => x.endsWith('_planks') && inv[x] >= v); if (!pk) return false; inv[pk] -= v;
                } else { if ((inv[k] || 0) < v) return false; inv[k] -= v; }
            }
            inv[name] = (inv[name] || 0) + r.out; crafted.push(name);
        }
        return true;
    };
    return { inv, crafted, craftLocal, counts: () => ({ ...inv }) };
}

test('T-0264: planks in the pack, no table → crafts a crafting_table', async () => {
    const f = fakeInv({ cobblestone: 135, stick: 8, birch_planks: 8, birch_log: 10 });
    assert.equal(await ensureCarriedTable({ counts: f.counts, craftLocal: f.craftLocal, nearTable: () => false }), true);
    assert.equal(f.inv.crafting_table, 1);
    assert.deepEqual(f.crafted, ['crafting_table']);
});

test('T-0264: only logs → planks first, then the table', async () => {
    const f = fakeInv({ cobblestone: 3, stick: 2, oak_log: 2 });
    assert.equal(await ensureCarriedTable({ counts: f.counts, craftLocal: f.craftLocal, nearTable: () => false }), true);
    assert.deepEqual(f.crafted, ['oak_planks', 'crafting_table']);
});

test('T-0264: a carried or nearby table → nothing to do; no wood at all → false', async () => {
    const f1 = fakeInv({ crafting_table: 1 });
    assert.equal(await ensureCarriedTable({ counts: f1.counts, craftLocal: f1.craftLocal, nearTable: () => false }), true);
    assert.deepEqual(f1.crafted, []);
    const f2 = fakeInv({});
    assert.equal(await ensureCarriedTable({ counts: f2.counts, craftLocal: f2.craftLocal, nearTable: () => true }), true);
    const f3 = fakeInv({ cobblestone: 9 });
    assert.equal(await ensureCarriedTable({ counts: f3.counts, craftLocal: f3.craftLocal, nearTable: () => false }), false);
});

test('T-0264: log → planks names (stems too)', () => {
    assert.equal(plankForLog('birch_log'), 'birch_planks');
    assert.equal(plankForLog('crimson_stem'), 'crimson_planks');
    assert.equal(plankForLog('stripped_oak_log'), 'oak_planks');
});

test('T-0264: mineDown fodder-recraft and surfaceUp emergency pick use the shared ensureCarriedTable', () => {
    const md = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    const i = md.indexOf('fodder-recraft');
    assert.ok(i > 0);
    assert.match(md.slice(i - 1200, i), /await ensureCarriedTable\(\{/);
    const su = fs.readFileSync(new URL('../bots/_supervisor/skills/surfaceUp.js', import.meta.url), 'utf8');
    assert.match(su, /const ensureTable = \(\) => ensureCarriedTable\(\{/);
});
