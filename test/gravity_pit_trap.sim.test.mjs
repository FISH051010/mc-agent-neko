import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { createRequire } from 'node:module';
import { digOneCapOne } from '../src/agent/library/skills.js';

// T-0066 / C334 (desert suffocation spiral): the night self-preservation dig-in tunnelled into a SAND column
// with nothing to cap it → the sand above collapsed onto the head → suffocated (naked + keepInventory off).
// Today's night pocket primitive digOneCapOne carries the same guard: a gravity column above/below and no cap
// block in hand → refuse (caller downgrades to seal/hold) and never dig.

const require = createRequire(import.meta.url);
const registry = require('minecraft-data')('1.21.1');

function desertBot({ inv = [], under = 'sand', y = 64 } = {}) {
    let digs = 0;
    const at = (p) => {
        if (p.y < y) return { name: under, boundingBox: 'block', position: p };
        return { name: 'air', boundingBox: 'empty', position: p };
    };
    const bot = {
        registry,
        entity: { position: new Vec3(0.5, y, 0.5), onGround: true },
        inventory: { items: () => inv.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
        blockAt: at,
        heldItem: null,
        output: '',
        modes: { isOn: () => false },
        dig: async () => { digs++; },
        interrupt_code: false,
    };
    return { bot, digs: () => digs };
}

test('T-0066/C334: standing on a sand column with NO cap block → refuse 挖三填一, dig nothing', async () => {
    const { bot, digs } = desertBot({ inv: [['stick', 3], ['wheat_seeds', 2]] });
    assert.equal(await digOneCapOne(bot), false);
    assert.equal(digs(), 0, 'digging one down into sand with nothing to cap = buried by the collapse');
    assert.match(bot.output, /gravity column/);
});

test('C334: gravel counts too; deep (y<=16) is refused regardless', async () => {
    const g = desertBot({ under: 'gravel' });
    assert.equal(await digOneCapOne(g.bot), false);
    assert.equal(g.digs(), 0);
    const deep = desertBot({ under: 'stone', y: 12, inv: [['dirt', 8]] });
    assert.equal(await digOneCapOne(deep.bot), false);
    assert.equal(deep.digs(), 0);
});
