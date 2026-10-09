import assert from 'node:assert/strict';
import test from 'node:test';
import Vec3 from 'vec3';
import { breakBlockAt } from '../src/agent/library/skills.js';

// Live 10-09 22:26:50-53 @-10,20,33: mineDown step 0 head cell = a stranded crafting_table; three dispatches each
// ended 2ms after START with "dig threw: invalid operation" (prismarine-windows acceptClick assert from the tool
// equip — no dig.begin was ever audited) → DUSK_MINE_NIGHT 5-min cooldown. A crafting table breaks bare-handed in
// ~3.75s: a failed tool swap must not fail the dig.
function fakeBot({ equipThrows }) {
    const pos = new Vec3(-10.5, 20, 32.5);
    const blocks = { '-12,20,32': 'crafting_table' };
    const bot = {
        output: '', interrupt_code: false, digs: 0, heldItem: null,
        entity: { position: pos },
        game: { gameMode: 'survival' },
        modes: { isOn: () => false },
        lookAt: async () => {},
        stopDigging: () => {},
        tool: { equipForBlock: async () => { if (equipThrows) throw new Error('invalid operation'); } },
        blockAt: (p) => {
            const n = blocks[`${p.x},${p.y},${p.z}`] || 'air';
            return { name: n, position: new Vec3(p.x, p.y, p.z), boundingBox: n === 'air' ? 'empty' : 'block',
                canHarvest: () => true, digTime: () => 3750 };
        },
        dig: async (b) => { bot.digs++; blocks[`${b.position.x},${b.position.y},${b.position.z}`] = 'air'; },
    };
    return bot;
}

test('T-0179: a tool-equip failure (window assert) does not abort the dig — break with what is held', async () => {
    const bot = fakeBot({ equipThrows: true });
    const r = await breakBlockAt(bot, -12, 20, 32);
    assert.equal(r, true);
    assert.equal(bot.digs, 1);
    assert.match(bot.output, /equip for crafting_table failed \(invalid operation\)/);
});

test('T-0179: normal path unchanged', async () => {
    const bot = fakeBot({ equipThrows: false });
    assert.equal(await breakBlockAt(bot, -12, 20, 32), true);
    assert.equal(bot.digs, 1);
});
