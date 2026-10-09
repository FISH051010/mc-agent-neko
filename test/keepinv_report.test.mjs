import test from 'node:test';
import assert from 'node:assert/strict';
import { deathAlertText, observeKeepInventory } from '../src/agent/keepinv_report.js';

test('2026-10-09: death alert never claims items were kept when keepInventory is verified OFF', () => {
  // live: keepinv.json value=false, bot lost every wooden pick, alert said 物品已保留.
  assert.doesNotMatch(deathAlertText(false), /已保留|不掉落，/);
  assert.match(deathAlertText(false), /已掉落/);
  assert.match(deathAlertText(true), /已保留/);
  assert.doesNotMatch(deathAlertText(null), /已保留|已掉落/);
});

test('2026-10-09: keepInventory is corrected from the inventory observed across a death', () => {
  assert.equal(observeKeepInventory(23, 0), false);
  assert.equal(observeKeepInventory(23, 23), true);
  assert.equal(observeKeepInventory(23, 10), null);   // partial loss → no verdict
  assert.equal(observeKeepInventory(0, 0), null);     // died empty-handed → no evidence
});
