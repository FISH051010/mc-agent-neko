import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { noteSkillDig, purposefulDigActive, PURPOSEFUL_DIG_WINDOW_MS } from '../src/agent/framework/mobility_signals.js';

// Live 10-09 21:26:43-46 @66,61,40: mineDown was wedge-digging a ghost (bot.dig) when a T-0135 SEALED escape episode
// started (T-0163 gate said "not working") — purposefulDigActive only knew the _bodyDigLockOwner slot, which mineDown /
// chopWood / breakBlockAt never take (only branchMine ore-window + pathfinder step-edge do). The episode then tunnelled
// 20 blocks for 40s while the kernel waited. Every bot.dig passes the mine_motion_audit wrapper — record it there.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('T-0163: a skill dig through bot.dig (no dig slot) counts as purposeful work for the window', () => {
    const bot = {};
    noteSkillDig(bot, 'kernelDriver', 1000);
    assert.equal(purposefulDigActive(bot, 1000 + 5000), true);
    assert.equal(purposefulDigActive(bot, 1000 + PURPOSEFUL_DIG_WINDOW_MS + 1), false);
});

test('T-0163: reflex digs (mobility/unstuck) never count — the escape must not keep itself alive', () => {
    const bot = {};
    noteSkillDig(bot, 'mode:mobility', 1000);
    assert.equal(purposefulDigActive(bot, 2000), false);
    noteSkillDig(bot, 'mode:unstuck', 1000);
    assert.equal(purposefulDigActive(bot, 2000), false);
    bot._bodyDigLockOwner = 'mobility:SEALED'; bot._bodyDigLockUntil = 0;
    noteSkillDig(bot, 'kernelDriver', 1000);
    assert.equal(purposefulDigActive(bot, 2000), false, 'slot held by the mobility reflex → its dig');
});

test('T-0163: the global bot.dig wrapper records skill digs', () => {
    const src = fs.readFileSync(path.join(root, 'src/agent/modes.js'), 'utf8');
    assert.match(src, /bot\.dig = async \(block, \.\.\.args\) => \{\s*\r?\n\s*const seq = \+\+bot\._mineMotionSeq;\s*\r?\n\s*const startedAt = Date\.now\(\);\s*\r?\n\s*try \{ noteSkillDig\(bot, agent && agent\.actions && agent\.actions\.currentActionLabel, startedAt\); \} catch \(e\) \{\}/);
});
