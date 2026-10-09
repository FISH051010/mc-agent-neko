import assert from 'node:assert/strict';
import test from 'node:test';
import { walkDugPath } from '../bots/_supervisor/skills/mineDown.js';

// Live 10-09 21:06:30-51 @0..6,59,37: T-0161 relocate tunnel ×4 'walk stopped early: cell k/9 … feet=air head=air
// floor=stone' with the bot parked 0.2-0.3b short of the next cell's face (pos 0.78 / 2.63 / 5.63) — the dig landed
// client-side only (server-solid ghost), so the body is wedged against a block the client reads as air. mineDown's
// stair step has forceUnghost for exactly this; walkDugPath had nothing → 3 failures → DUSK_MINE_NIGHT cooled 5min.
class V { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }

function fakeBot(ghosts) {
    const bot = { entity: { position: new V(-0.5, 59, 37.5), onGround: true }, ctl: {}, aim: null, digs: [] };
    bot.lookAt = async (v) => { bot.aim = v; };
    bot.setControlState = (k, on) => { bot.ctl[k] = on; };
    bot.clearControlStates = () => { bot.ctl = {}; };
    bot.dig = async (b) => { bot.digs.push(`${b.position.x},${b.position.y},${b.position.z}`); ghosts.delete(b.position.x); };
    bot.stopDigging = () => {};
    const tick = setInterval(() => {
        if (!bot.ctl.forward || !bot.aim) return;
        const p = bot.entity.position;
        const dx = Math.sign(bot.aim.x - p.x);
        let nx = p.x + dx * 0.2;
        const cell = Math.floor(nx + 0.3 * dx);          // leading hitbox edge
        if (ghosts.has(cell)) nx = dx > 0 ? cell - 0.3 : cell + 1.3;   // server pushes back to the face
        p.x = Math.abs(nx - bot.aim.x) < 0.2 ? bot.aim.x : nx;
    }, 20);
    bot.stop = () => clearInterval(tick);
    return bot;
}
const bn = (x, y, z) => ({ name: y === 58 ? 'stone' : 'air', boundingBox: y === 58 ? 'block' : 'empty', position: new V(x, y, z) });
const skills = { breakBlockAt: async () => true };

test('T-0161: a server-side ghost on the tunnel line is dug out and the walk continues (not "walk stopped early")', async () => {
    const ghosts = new Set([1, 3]);
    const bot = fakeBot(ghosts);
    try {
        const ok = await walkDugPath(bot, skills, V, bn, [[0, 37], [1, 37], [2, 37], [3, 37], [4, 37]]);
        assert.equal(ok, true, `walk should arrive; fail=${bot._walkDugFail}`);
        assert.ok(bot.digs.some(d => d.startsWith('1,')) && bot.digs.some(d => d.startsWith('3,')), `ghost cells dug: ${bot.digs}`);
        assert.ok(Math.abs(bot.entity.position.x - 4.5) < 0.5);
    } finally { bot.stop(); }
});

test('T-0161: a cell that stays blocked after the ghost dig still fails honestly with a diagnosis', async () => {
    const ghosts = new Set([2]);
    const bot = fakeBot(ghosts);
    bot.dig = async () => {};                             // dig never clears it (real wall the client can't see)
    try {
        const ok = await walkDugPath(bot, skills, V, bn, [[0, 37], [1, 37], [2, 37]]);
        assert.equal(ok, false);
        assert.match(bot._walkDugFail, /cell 3\/3 @2,59,37/);
    } finally { bot.stop(); }
});
