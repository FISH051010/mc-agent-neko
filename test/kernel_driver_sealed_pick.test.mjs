import assert from 'node:assert/strict';
import test from 'node:test';
import { reflexBusy } from '../bots/_supervisor/skills/kernelDriver.js';

// Live 10-10 00:16:52→00:17:58+: dawn in the bot's own night pocket at y34 → T-0135 SEALED escape episode; kernelDriver
// yielded to SEALED, so no task ran while mobility tunnelled ~23 blocks through solid rock (underground there is no
// "outside" to reach — up to the 5-min episode cap). A bot with a pickaxe in stone is not trapped: let the kernel's
// task dig (its first dig ends the episode via the T-0163 working gate). Pickless SEALED still yields to the escape.
const pack = (...names) => ({ items: () => names.map(name => ({ name, count: 1 })) });
const mk = (state, inventory) => ({ _mobility: { state, enclosed: true }, _world: { threat: {}, vitals: { food: 20 } }, inventory });

test('T-0194: SEALED with a pickaxe is not reflex-busy; pickless SEALED and ENTOMBED still are', () => {
    assert.equal(reflexBusy(mk('SEALED', pack('stone_pickaxe'))), false);
    assert.equal(reflexBusy(mk('SEALED', pack('dirt'))), true);
    assert.equal(reflexBusy(mk('ENTOMBED', pack('stone_pickaxe'))), true);
});
