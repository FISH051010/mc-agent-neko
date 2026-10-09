// T-0147: replenishKit ② chopWood 限时 120s 到时只停寻路, chopWood 循环本身不停 → 幽灵 chopWood 继续砍树, 与 mineDown
// 抢挖掘 → "dig threw: Digging aborted" ×3 → GO_UNDERGROUND 冷却 (实录 10-10 19:23:47-57Z)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { supersedeChop } from '../bots/_supervisor/skills/replenishKit.js';

test('T-0147: supersedeChop bump chopWood 代号 (使旧循环 _superseded 为真) 并中止挖掘', () => {
    let stopped = 0;
    const bot = { _chopGen: 7, stopDigging: () => { stopped++; } };
    const genAtEntry = bot._chopGen;                    // chopWood ENTER 时记下的 _gen
    const superseded = () => bot._chopGen !== genAtEntry;   // chopWood 的 _superseded 判据
    assert.equal(superseded(), false);
    supersedeChop(bot);
    assert.equal(superseded(), true, 'orphan chop loop must see itself superseded');
    assert.equal(stopped, 1);
});

test('T-0147: replenishKit 的 chopWood 超时分支调用 supersedeChop', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/replenishKit.js', import.meta.url), 'utf8');
    const i = src.indexOf("'replenish-chop-timeout'");   // T-0148: now via skills.chopWoodWithin(…, 'replenish-chop-timeout', …)
    const catchBlock = src.slice(i, src.indexOf('chopWood incomplete', i));
    assert.ok(/supersedeChop\(bot\)/.test(catchBlock), 'timeout catch supersedes the orphan chop loop');
});
