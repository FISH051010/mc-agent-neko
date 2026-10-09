import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { digInterrupter } from '../bots/_supervisor/skills/mineDown.js';

// 监工 10-10 19:23:54-57: mineDown 'dig threw: Digging aborted' ×3 with no clue who interrupted the dig.
test('T-0148: a "Digging aborted" DONE line names who held the body / dig slot at that moment', () => {
    const s = digInterrupter({ _bodyOwner: { name: 'mode:mobility' }, _bodyDigLockOwner: 'mobility:ENTOMBED',
        targetDigBlock: { name: 'spruce_log', position: '12,72,13' }, _chopGen: 9 });
    assert.match(s, /owner=mode:mobility/);
    assert.match(s, /digSlot=mobility:ENTOMBED/);
    assert.match(s, /digging=spruce_log@12,72,13/);
    assert.equal(digInterrupter({}), '[by owner=- digSlot=- digging=- chopGen=-]');
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.match(src, /abort = `dig threw: \$\{e && e\.message \|\| e\}\$\{\/aborted\/i\.test/);
});
