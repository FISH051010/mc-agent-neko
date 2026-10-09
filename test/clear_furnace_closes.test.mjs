import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// T-0179 source (worker-tier): smeltSafe clearAndPickUp → skills.clearNearestFurnace opened the furnace window and
// never closed it → every later equip clicked an inventory slot into the furnace window ('invalid operation', 22:26→
// 22:42). The window must close on every exit path of clearNearestFurnace, including a throw mid-take.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0179: clearNearestFurnace closes the furnace window in a finally', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/library/skills.js'), 'utf8');
    const i = src.indexOf('export async function clearNearestFurnace(bot) {');
    const body = src.slice(i, src.indexOf('\nexport async function', i + 10));
    assert.match(body, /const furnace = await bot\.openFurnace\(furnaceBlock\);\s*\r?\n\s*try \{/);
    assert.match(body, /\} finally \{\s*\r?\n\s*try \{ bot\.closeWindow\(furnace\); \} catch \(e\) \{\}/);
});
