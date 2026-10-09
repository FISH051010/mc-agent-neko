import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T-0017: placeBlockNearby couldn't find a flat face for the crafting table and "made room" by pillaring — a 1-wide
// column never gains a legal neighbour, so it stacked 79 cobble from y77 to y161 and stranded the bot in the sky.
// Every pillar loop inside placeBlockNearby must stay hard-bounded (structural pin — full placement sim is heavy;
// behavior side of placement is covered by test/placement_recovery.sim.test.mjs).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0017: every pillar loop in placeBlockNearby is bounded (<=8 steps) and the cramped-pillar loop stops below y70', () => {
    const src = fs.readFileSync(path.join(root, 'src', 'agent', 'library', 'skills.js'), 'utf8');
    const start = src.indexOf('export async function placeBlockNearby');
    const end = src.indexOf('\nexport ', start + 10);
    const body = src.slice(start, end);
    const loops = [...body.matchAll(/for \(let up = 0; allowPillar && up < (\d+)([^;]*);/g)];
    assert.ok(loops.length >= 2, `pillar loops found: ${loops.length}`);
    for (const l of loops) assert.ok(Number(l[1]) <= 8, `unbounded-ish pillar loop: up < ${l[1]}`);
    assert.ok(loops.some(l => /Math\.floor\(bot\.entity\.position\.y\) < 70/.test(l[2])), 'cramped pillar must be height-capped');
    assert.doesNotMatch(body, /while\s*\([^)]*pillar/i, 'no open-ended pillar while-loop');
});
