import test from 'node:test';
import assert from 'node:assert/strict';
import { currentOwner, resolve } from '../src/agent/framework/arbiter.js';

const idleBot = () => ({
  pathfinder: { isMoving: () => false, goal: null },
  targetDigBlock: null,
  usingHeldItem: false,
  controlState: { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false },
});

test('T-0112: an idle body between kernel dispatches has no owner (no ghost ws:* holder)', () => {
  // kernelDriver runs as a ws run_skill forever → supervised_skill stays 'ws' while the kernel deliberates.
  const agent = { bot: idleBot(), supervised_skill: 'ws' };
  assert.equal(currentOwner(agent), null);
  const v = resolve(currentOwner(agent), { name: 'mode:mobility', kind: 'mode' }, { agent, enforce: true });
  assert.equal(v.winner, 'claimant');
});

test('T-0112: a legacy ws skill that is actually driving the body still holds it', () => {
  const moving = idleBot();
  moving.pathfinder.isMoving = () => true;
  assert.equal(currentOwner({ bot: moving, supervised_skill: 'ws' })?.name, 'ws:*');

  const digging = idleBot();
  digging.targetDigBlock = { name: 'stone' };
  assert.equal(currentOwner({ bot: digging, supervised_skill: 'ws' })?.name, 'ws:*');

  const walking = idleBot();
  walking.controlState.forward = true;
  assert.equal(currentOwner({ bot: walking, supervised_skill: 'ws' })?.name, 'ws:*');
});

test('T-0112: a real body-owner token always wins over the idle check', () => {
  const bot = idleBot();
  bot._bodyOwner = { name: 'kernel:replenishKit', kind: 'skill', since: 1 };
  assert.equal(currentOwner({ bot, supervised_skill: 'ws' }).name, 'kernel:replenishKit');
});
