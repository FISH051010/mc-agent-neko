import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyKeepInvReply } from '../src/agent/world_scope.js';

// T-0071 / C344v2: keepInventory was "set" only on a rescue path and assumed ON afterwards; on a new world it was
// really OFF, every death dropped the iron kit → tier relapse. Now the bot only QUERIES the gamerule (read-only;
// setting it is the user's call) and must classify the answer honestly: no permission / no answer = UNVERIFIED,
// never "ON".

const q = (txt) => classifyKeepInvReply(txt, { translate: 'commands.gamerule.query', with: ['keepInventory'] });

test('T-0071: query answers are read literally (EN / 中文)', () => {
    assert.equal(q('Gamerule keepInventory is currently set to: true').verdict, true);
    assert.equal(q('Gamerule keepInventory is currently set to: false').verdict, false);
    assert.equal(classifyKeepInvReply('游戏规则 keepInventory 目前为：false', {}).verdict, false);
});

test('T-0071: permission refusal / unknown command → UNVERIFIED (null), never assumed ON', () => {
    const r = classifyKeepInvReply('You do not have permission to use this command', {});
    assert.ok(r);
    assert.equal(r.verdict, null);
    assert.equal(classifyKeepInvReply('Unknown or incomplete command, see below for error', {}).verdict, null);
});

test('C344v2: unrelated chat / other gamerules are ignored (no latching onto the wrong answer)', () => {
    assert.equal(classifyKeepInvReply('Gamerule doDaylightCycle is currently set to: true', { translate: 'commands.gamerule.query', with: ['doDaylightCycle'] }), null);
    assert.equal(classifyKeepInvReply('<Steve> keepInventory is true right?', {}), null);
});
