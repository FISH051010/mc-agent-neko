import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 10-11 (worker-death, T-0288): `ticket.mjs update T-0288 --status duplicate --resolution …` printed "updated T-0288 → duplicate"
// although the server answered 400 (no such status) and --resolution was silently dropped — the ticket stayed as it was.
// End-to-end: a REAL ticket-server on a temp dir (TICKET_DIR) + random port, driven by the REAL CLI. Never touches live tickets/.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(root, 'bots', '_supervisor', 'ticket-server.mjs');
const CLI = path.join(root, 'bots', '_supervisor', 'ticket.mjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-e2e-'));
const port = String(49100 + Math.floor(Math.random() * 800));
const env = { ...process.env, TICKET_DIR: dir, TICKET_PORT: port };
let srv;

test.before(async () => {
    srv = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('ticket-server did not start');
});
test.after(() => { try { srv.kill(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const cli = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const status = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));

test('T-0288: a status the server rejects → CLI reports the reason + valid list, exits non-zero, never prints "updated"', () => {
    const id = /created (T-\d+)/.exec(cli('create', '--type', 'misc', '--title', 'a').out)[1];
    const r = cli('update', id, '--status', 'bogus', '--as', 't');
    assert.notEqual(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /updated/);
    assert.match(r.out, /bad status 'bogus'/);
    assert.match(r.out, /valid: open, claimed, in_progress, fixed, verifying, closed, wontfix, duplicate/);
    assert.equal(status(id).status, 'open');
});

test('T-0288: unknown options are an error, not silently dropped (--resolution was never an option)', () => {
    const id = /created (T-\d+)/.exec(cli('create', '--type', 'misc', '--title', 'b').out)[1];
    const r = cli('update', id, '--status', 'fixed', '--resolution', 'x', '--as', 't');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /unknown option --resolution for 'update'/);
    assert.equal(status(id).status, 'open', 'nothing was sent');
    assert.equal(cli('comment', id, 'hi', '--bogus', 'y').code, 1);
    assert.equal(cli('frobnicate').code, 1, 'unknown command');
});

test('T-0288: duplicate (needs --of an existing other ticket) and wontfix are terminal statuses', () => {
    const a = /created (T-\d+)/.exec(cli('create', '--type', 'misc', '--title', 'orig').out)[1];
    const b = /created (T-\d+)/.exec(cli('create', '--type', 'misc', '--title', 'dup').out)[1];
    assert.equal(cli('update', b, '--status', 'duplicate', '--as', 't').code, 1, 'no --of');
    assert.match(cli('update', b, '--status', 'duplicate', '--of', 'T-9999', '--as', 't').out, /no such ticket/);
    assert.match(cli('update', b, '--status', 'duplicate', '--of', b, '--as', 't').out, /cannot duplicate itself/);
    assert.equal(cli('update', b, '--status', 'fixed', '--of', a, '--as', 't').code, 1, '--of only with duplicate');
    const r = cli('update', b, '--status', 'duplicate', '--of', a, '--as', 't');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`updated ${b} → duplicate of ${a}`));
    assert.equal(status(b).status, 'duplicate');
    assert.equal(status(b).duplicateOf, a);
    assert.doesNotMatch(cli('list').out, new RegExp(b), 'terminal: not in the active list');
    assert.match(cli('list', 'duplicate').out, new RegExp(b));
    assert.equal(cli('update', a, '--status', 'wontfix', '--as', 't').code, 0);
    assert.doesNotMatch(cli('list').out, new RegExp(a));
    assert.equal(cli('update', b, '--status', 'open', '--as', 't').code, 0);
    assert.equal(status(b).duplicateOf, undefined, 'leaving duplicate drops the pointer');
});

test('T-0288: the board shows the duplicate pointer and offers the new terminal statuses', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.match(src, /→ duplicate of '\+t\.duplicateOf/);
    assert.match(src, /'closed','wontfix','duplicate'\]\.map/);
    assert.match(src, /<option value=duplicate>duplicate<\/option>/);
});
