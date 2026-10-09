import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeStrayContainerWindow } from '../src/agent/library/skills.js';

// Live 10-09 22:26→22:32+: after smeltSafe's interrupted wrap-up (no 'furnace picked up') EVERY equip failed with
// prismarine-windows 'invalid operation' (mine_motion equip-failed ×50+, mineDown 'dig threw' ×6, reclaimTable 3ms
// no-op). mineflayer clickWindow targets `bot.currentWindow || bot.inventory`: with a furnace window left open, an
// inventory slot number is out of that window's range → the acceptClick assert. Equipping never wants a container.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0179: a leftover container window is closed before equipping; the player inventory window is left alone', () => {
    let closed = 0;
    const furnace = { type: 'minecraft:furnace' };
    const bot = { currentWindow: furnace, closeWindow: (w) => { closed++; assert.equal(w, furnace); bot.currentWindow = null; } };
    assert.equal(closeStrayContainerWindow(bot), true);
    assert.equal(closed, 1);
    assert.equal(bot.currentWindow, null);
    assert.equal(closeStrayContainerWindow(bot), false, 'nothing open → no-op');
    bot.currentWindow = { type: 'minecraft:inventory' };
    assert.equal(closeStrayContainerWindow(bot), false);
    assert.equal(closed, 1);
});

test('T-0179: the global bot.equip wrapper closes a stray window first', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /bot\.equip = async \(item, destination, \.\.\.args\) => \{\s*\r?\n\s*try \{ if \(skills\.closeStrayContainerWindow\(bot\)\) write\('equip\.closed_stray_window', \{ item: itemName\(item\) \}\); \} catch \(e\) \{\}/);
});
