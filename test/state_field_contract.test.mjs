import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lost-half-fix detector. Twice in one sweep (T-0089 villageHarvest cooldown, T-0103 就地取材) a fix's
// WRITER half was never committed while its READER half survived — the gate then silently reads
// `undefined` forever. Every `bot._field` that is read somewhere must be written somewhere.
// If this fails: either restore the writer, or (if the read is intentionally defensive/dead) add the
// field to ALLOW below with a one-line reason.
const ALLOW = {
    client: 'mineflayer internal (bot._client)',
    sleeping: 'world_model.sleepInstinctEngaged probes several possible sleep signals defensively',
    mobilityPlannedNoPickStoneUntil: 'modes.js mobility dedicated hook split off 06-13 (49c9637); no planner writes it yet — falls back to enclosed',
    hungerGateHunt: 'feedUp nested-hunt exemption; its writer (prepNether hunger gate) retired with prepNether/BOOTSTRAP_KIT 07-09',
    nightSealed: 'comment in nightShelter.js describing the retired boolean flag (now _nightSealedUntil)',
    woodBarren: 'comment wildcard "bot._woodBarren*" in migration_triggers.js',
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sources() {
    const files = [];
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
            else if (/\.(m?js|cjs)$/.test(e.name)) files.push(p);
        }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'bots', '_supervisor', 'skills'));
    walk(path.join(root, 'bots', '_supervisor', 'core'));
    for (const f of fs.readdirSync(path.join(root, 'bots', '_supervisor'))) {
        if (/\.m?js$/.test(f)) files.push(path.join(root, 'bots', '_supervisor', f));
    }
    return files;
}

test('T-0089 class: every bot._field that is read is also written somewhere (no orphaned gate)', () => {
    const reads = new Map();
    const writes = new Set();
    for (const f of sources()) {
        const s = fs.readFileSync(f, 'utf8');
        for (const m of s.matchAll(/\b(?:bot|bot2|b|this\.bot|agent\.bot)\._([A-Za-z0-9]+)/g)) {
            if (!reads.has(m[1])) reads.set(m[1], new Set());
            reads.get(m[1]).add(path.relative(root, f));
        }
        for (const m of s.matchAll(/\._([A-Za-z0-9]+)\s*(?:\[[^\]]*\])?\s*(?:=[^=]|\+\+|--|\+=|-=|\|\|=|\?\?=)/g)) writes.add(m[1]);
        for (const m of s.matchAll(/['"]_([A-Za-z0-9]+)['"]\s*(?:,|\])/g)) writes.add(m[1]);   // defineProperty / bracket keys
        for (const m of s.matchAll(/\b_([A-Za-z0-9]+)\s*:/g)) writes.add(m[1]);                // Object.assign(bot, { _x: … })
        for (const m of s.matchAll(/delete\s+\w+\._([A-Za-z0-9]+)/g)) writes.add(m[1]);
    }
    const orphans = [...reads.keys()].filter(k => !writes.has(k) && !(k in ALLOW))
        .map(k => `bot._${k} read in ${[...reads.get(k)].join(', ')} — never written`);
    assert.deepEqual(orphans, []);
});
