import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// T-0047 / C310: hp4 bot with 14 steak in the bag never ate — feedUp's "critical" hostile guard `break`-ed the
// loop BEFORE the eat step because an UNREACHABLE mob was nearby → no regen → frozen at hp4. Eating held food
// in place is always safe; the hostile guard may only gate the roam/hunt path. Structural pin (feedUp's entry
// gates make a full sim brittle): inside the hunt loop, eat() must come before the hostile bail.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0047/C310: feedUp eats held food before any hostile-guard bail in the hunt loop', () => {
    const src = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'skills', 'feedUp.js'), 'utf8');
    const loop = src.indexOf('while ((bot.food < targetFood || rationsCount() < 2) && tries++ < 10) {');
    assert.ok(loop > 0, 'hunt loop not found');
    const body = src.slice(loop, loop + 4000);
    const eatAt = body.indexOf('if (await eat()) {');
    const bailAt = body.search(/if \(hostileNear\(\d+\)\) \{/);
    assert.ok(eatAt > 0 && bailAt > 0, `eat=${eatAt} bail=${bailAt}`);
    assert.ok(eatAt < bailAt, 'the hostile bail must not pre-empt eating food already in the bag');
});
