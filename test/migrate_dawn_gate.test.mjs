// T-0120: death #2 (2026-10-09 16:16:59, tod=479) — an unarmored bot was force-migrated out of its
// night pocket at dawn and shot by a skeleton that had not burned yet (spruce shade). migrate's own
// isNight() ends at 23000, so dawn (→~1800) counted as safe travel time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dawnUndeadHold } from '../bots/_supervisor/skills/migrate.js';

const base = { tod: 479, armorPieces: 0, hasShield: false, undeadNear: 1 };

test('T-0120: dawn + unarmored + unburnt undead within range → hold the march', () => {
    assert.equal(dawnUndeadHold(base), true);
    assert.equal(dawnUndeadHold({ ...base, tod: 23100 }), true, 'pre-dawn tail (world_model already says day)');
});

test('T-0120: no hold once the window passes, the bot is armored/shielded, or no undead are around', () => {
    assert.equal(dawnUndeadHold({ ...base, tod: 3000 }), false);
    assert.equal(dawnUndeadHold({ ...base, armorPieces: 2 }), false);
    assert.equal(dawnUndeadHold({ ...base, hasShield: true }), false);
    assert.equal(dawnUndeadHold({ ...base, undeadNear: 0 }), false);
});
