import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { collectExcludeForTarget } from '../bots/_supervisor/skills/chopWood.js';

// 10-11 05:57:48→06:01:37Z @30,67,-9 (监工, T-0271 验收效率): chopWood chose the nearest GROUNDED tree (T-0256), but then called
// skills.collectBlock(bot, 'spruce_log', …) by TYPE — collectBlock re-picked the nearest spruce_log on its own: the dangling trunk
// spruce_log@30,73,-10 six blocks over the bot. 76 path attempts to GoalNear(30,73,-10) (partial, len 0 — the bot stood still,
// ctrl '-', path 0), 9 digs of it all 'Digging aborted'; only after that timed out did raw-approach walk at the chosen tree for
// 2.5s. Hand collectBlock the chosen tree: exclude every same-type log that isn't in its trunk column.
test('T-0272: logs outside the chosen trunk column are excluded; the trunk column stays collectable', () => {
    const target = { x: 39, y: 68, z: -3 };
    const near = [{ x: 30, y: 73, z: -10 }, { x: 39, y: 68, z: -3 }, { x: 39, y: 69, z: -3 }, { x: 27, y: 72, z: -11 }];
    assert.deepEqual(collectExcludeForTarget(near, target), [{ x: 30, y: 73, z: -10 }, { x: 27, y: 72, z: -11 }]);
});

test('T-0272: nothing nearer / nothing to exclude → null (collectBlock behaves as before)', () => {
    assert.equal(collectExcludeForTarget([{ x: 39, y: 68, z: -3 }], { x: 39, y: 68, z: -3 }), null);
    assert.equal(collectExcludeForTarget([], { x: 1, y: 1, z: 1 }), null);
});

test('T-0272: chopWood passes the exclude list to collectBlock', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/chopWood.js', import.meta.url), 'utf8');
    assert.match(src, /skills\.collectBlock\(bot, nearest\.t, 1, _cbExclude, true\)/);
    assert.match(src, /const _cbExclude = \(\(\) => \{/);
});

// (3) 监工 06:00:05 截帧: 地上散落 3 张以前放下的工作台; 零镐开局又花 4 板造口袋台。
test('T-0272: zero pick on the surface walks to a placed table within 12b and skips the pocket table while near one', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    assert.match(src, /if \(!stop\(\) && !overBudget\(\) && picks\(\) === 0 && cnt\('crafting_table'\) < 1 && !tableNear\(\) && onSurface\(\)\) \{/);
    assert.match(src, /world\.getNearestBlock\(bot, 'crafting_table', 12\)/);
    assert.match(src, /&& !\(picks\(\) === 0 && tableNear\(\)\)\) \{/);
});
