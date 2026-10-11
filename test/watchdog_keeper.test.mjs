import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeWatchdogKeeper, watchdogLastBeat, watchdogReviveAlert, WATCHDOG_STALE_S, WATCHDOG_REVIVE_GAP_MS } from '../bots/_supervisor/botwatch-trackers.mjs';

// T-0270: the watchdog was a single point of failure — killed from outside at 10-11 13:35 (no EXIT line, its children
// survived), nobody relaunched it, main.js stayed down 7 min until a session hook happened to run ensure-stack.
// botwatch now keeps the watchdog alive (reverse keep-alive). Dead = no process AND watchdog.log silent.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-10-11T05:40:00Z');
const stale = T0 - (WATCHDOG_STALE_S + 60) * 1000;
const fresh = T0 - 30 * 1000;

test('T-0270: watchdog process gone + heartbeat stale → revive', () => {
    const k = makeWatchdogKeeper();
    assert.equal(k.decide({ procAlive: false, lastBeatMs: stale, now: T0 }).action, 'revive');
});

test('T-0270: process alive + heartbeat fresh → no revive', () => {
    const k = makeWatchdogKeeper();
    assert.equal(k.decide({ procAlive: true, lastBeatMs: fresh, now: T0 }).action, 'ok');
});

test('T-0270: one signal alone never relaunches (alive-but-silent = hung, blind query = ok, fresh log = ok)', () => {
    const k = makeWatchdogKeeper();
    assert.equal(k.decide({ procAlive: true, lastBeatMs: stale, now: T0 }).action, 'hung');
    assert.equal(k.decide({ procAlive: null, lastBeatMs: stale, now: T0 }).action, 'ok');
    assert.equal(k.decide({ procAlive: false, lastBeatMs: fresh, now: T0 }).action, 'ok');
});

test('T-0270: revive is throttled to one per 5 min and a failed revive is counted', () => {
    const k = makeWatchdogKeeper();
    assert.equal(k.decide({ procAlive: false, lastBeatMs: stale, now: T0 }).action, 'revive');
    const d1 = k.decide({ procAlive: false, lastBeatMs: stale, now: T0 + 60000 });
    assert.equal(d1.action, 'throttled');
    assert.equal(d1.failStreak, 1, 'still dead one tick after the revive = failed attempt');
    const d2 = k.decide({ procAlive: false, lastBeatMs: stale, now: T0 + WATCHDOG_REVIVE_GAP_MS + 1000 });
    assert.equal(d2.action, 'revive');
    assert.equal(d2.failStreak, 1);
    // comes back → streak cleared
    assert.equal(k.decide({ procAlive: true, lastBeatMs: T0 + WATCHDOG_REVIVE_GAP_MS + 30000, now: T0 + WATCHDOG_REVIVE_GAP_MS + 60000 }).failStreak, 0);
});

test('T-0270: last beat parses the +08:00 log stamps and skips the keeper\'s own note', () => {
    const log = [
        '[2026-10-11T13:33:09.3054608+08:00] heartbeat up=1 err=21s deaths=55',
        '[2026-10-11T13:35:21.7376265+08:00] heartbeat up=1 err=30s deaths=55 pos=-4,59,-4',
        '[2026-10-11T05:41:00.000Z] botwatch keeper: watchdog DOWN (no process, log silent 339s) — running ensure-stack',
        '',
    ].join('\r\n');
    const b = watchdogLastBeat(log);
    assert.equal(b.ts, Date.parse('2026-10-11T05:35:21.737Z'));
    assert.match(b.line, /heartbeat up=1 err=30s/);
    assert.equal(watchdogLastBeat('').ts, null);
});

test('T-0270: the ALERTS line carries the scene — last beat time and the last line before death', () => {
    const beat = watchdogLastBeat('[2026-10-11T13:35:21.7376265+08:00] heartbeat up=1 err=30s deaths=55');
    const line = watchdogReviveAlert({ stamp: '10-11 05:41:00', ageS: 339, beat, failStreak: 2 });
    assert.match(line, /WATCHDOG DOWN/);
    assert.match(line, /last beat 2026-10-11T05:35:21/);
    assert.match(line, /last line: \[2026-10-11T13:35:21/);
    assert.match(line, /FAILED x2/);
});

test('T-0270: botwatch runs the keeper through ensure-stack; the process query excludes itself; watchdog logs its exit', () => {
    const bw = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'botwatch.mjs'), 'utf8');
    assert.match(bw, /makeWatchdogKeeper\(\)/);
    assert.match(bw, /ensure-stack\.ps1/);
    assert.match(bw, /\$_\.ProcessId -ne \$PID -and \$_\.CommandLine -like '\*watchdog\.ps1\*'/, 'the query powershell matches its own command line otherwise');
    assert.match(bw, /ALERTS\.txt/);
    const wd = fs.readFileSync(path.join(root, 'watchdog.ps1'), 'utf8');
    assert.match(wd, /\} finally \{\s*\r?\n\s*try \{ Add-Content \$log "\[\$\(Get-Date -Format o\)\] watchdog EXIT/);
});
