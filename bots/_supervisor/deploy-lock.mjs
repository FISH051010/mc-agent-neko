// deploy-lock.mjs — 部署闸门的机制载体（替代"在工单里 comment deploying now"的口头约定）。
//
// ★2026-10-10 实录撞车: worker-death 16:21:22Z 在 T-0105 comment "deploying now", worker-stuck 的
//   锁检查脚本按 updatedAt 过滤漏扫, 16:21:58 又杀掉 watchdog 刚拉起 12s 的 main.js。约定靠每个人
//   各自去扫评论 = 迟早漏。现在锁是一个原子创建的文件: 谁先 O_EXCL 建成谁持有, 其余人 acquire 直接失败。
//
// 用法 (node 走 PowerShell):
//   node bots/_supervisor/deploy-lock.mjs acquire --as worker-x --reason "T-0123 main.js restart"
//   ... 部署 + 冒烟自检 ...
//   node bots/_supervisor/deploy-lock.mjs release --as worker-x
//   node bots/_supervisor/deploy-lock.mjs status
//   node bots/_supervisor/deploy-lock.mjs live <sha> [--proc main|botwatch]   # ★T-0114 捎带判定: exit 0 = 已随别人重启上线, 不用再重启
// acquire 失败 exit 1 并打印持有者; 超过 TTL (默认 15min) 的锁视为持有者已死, 可被接管 (会打印接管记录)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const DEFAULT_TTL_MS = 15 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LOCK_FILE = path.join(here, 'deploy.lock');

function readLock(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}

export function status({ file = DEFAULT_LOCK_FILE, now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    const lock = readLock(file);
    if (!lock) return { held: false };
    const ageMs = now - (lock.at || 0);
    return { held: ageMs < ttlMs, stale: ageMs >= ttlMs, ageMs, ...lock };
}

export function acquire({ actor, reason = '', file = DEFAULT_LOCK_FILE, now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!actor) throw new Error('acquire needs --as <actor>');
    const body = JSON.stringify({ actor, reason, at: now, pid: process.pid });
    const tryCreate = () => {
        try { fs.writeFileSync(file, body, { flag: 'wx' }); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    };
    if (tryCreate()) return { ok: true };
    const cur = status({ file, now, ttlMs });
    if (cur.held && cur.actor === actor) return { ok: true, reentrant: true };
    if (cur.held) return { ok: false, holder: cur };
    // stale (or unreadable): take it over. Rename-then-create keeps the takeover itself exclusive.
    const tomb = `${file}.stale-${now}-${process.pid}`;
    try { fs.renameSync(file, tomb); } catch (e) { return { ok: false, holder: cur }; }   // someone else won the takeover
    try { fs.unlinkSync(tomb); } catch (e) {}
    return tryCreate() ? { ok: true, tookOverFrom: cur } : { ok: false, holder: status({ file, now, ttlMs }) };
}

export function release({ actor, file = DEFAULT_LOCK_FILE } = {}) {
    const cur = readLock(file);
    if (!cur) return { ok: true, wasFree: true };
    if (cur.actor !== actor) return { ok: false, holder: cur };
    try { fs.unlinkSync(file); } catch (e) {}
    return { ok: true };
}

// ── ★T-0114 捎带判定 (worker-death 建议): a commit is ALREADY LIVE when the running process started after
//    the commit LANDED in the deploy tree — e.g. 00:21 worker-death's C356-C358 rode worker-stuck's restart.
//    Landing time ≠ commit time (a branch rebased at 00:10 can be ff-merged at 00:21), so read it from the
//    deploy branch's reflog: the oldest entry whose tip contains the commit. Skips needless stacked restarts.
/** @param entries reflog [{sha, atMs}] newest-first; @param contains(tipSha) → tip has the commit */
export function landedAt(entries, contains) {
    let at = null;
    for (const e of entries) { if (contains(e.sha)) at = e.atMs; else break; }   // newest→oldest until it disappears
    return at;
}
export function alreadyLive({ landedMs, procStartMs }) {
    return Number.isFinite(landedMs) && Number.isFinite(procStartMs) && procStartMs > landedMs;
}
function gitOut(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
function landedAtGit(sha, cwd) {
    const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    const lines = gitOut(['reflog', 'show', '--date=unix', '--format=%H %gd', '-n', '300', branch], cwd).split(/\r?\n/);
    const entries = lines.map(l => { const m = l.match(/^([0-9a-f]{40}) .*@\{(\d+)\}$/); return m && { sha: m[1], atMs: Number(m[2]) * 1000 }; }).filter(Boolean);
    const contains = (tip) => { try { execFileSync('git', ['merge-base', '--is-ancestor', sha, tip], { cwd, stdio: 'ignore' }); return true; } catch (e) { return false; } };
    return landedAt(entries, contains);
}
function procStartMsWin(re) {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${re}' } | ForEach-Object { $_.CreationDate.ToUniversalTime().ToString('o') }`;
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
    const ts = out.map(Date.parse).filter(Number.isFinite);
    return ts.length ? Math.max(...ts) : null;
}

function parseArgs(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
    }
    return flags;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [cmd, ...rest] = process.argv.slice(2);
    const f = parseArgs(rest);
    const actor = f.as || process.env.TICKET_ACTOR;
    const fmt = (h) => `${h.actor} since ${new Date(h.at).toISOString()} (${Math.round(h.ageMs / 1000)}s ago) — ${h.reason || ''}`;
    if (cmd === 'acquire') {
        const r = acquire({ actor, reason: f.reason || '' });
        if (r.ok) console.log(`✓ deploy lock acquired by ${actor}${r.reentrant ? ' (already held)' : ''}${r.tookOverFrom ? ` — took over STALE lock of ${fmt(r.tookOverFrom)}` : ''}`);
        else { console.log(`✗ deploy lock HELD by ${fmt(r.holder)} — wait for release (status: deploy-lock.mjs status)`); process.exitCode = 1; }
    } else if (cmd === 'release') {
        const r = release({ actor });
        if (r.ok) console.log(r.wasFree ? 'lock was already free' : `✓ released by ${actor}`);
        else { console.log(`✗ not yours — held by ${r.holder.actor}`); process.exitCode = 1; }
    } else if (cmd === 'live') {
        const sha = rest[0];
        const procRe = f.proc === 'botwatch' ? 'botwatch\.mjs' : 'init_agent';
        const repo = f.repo || path.resolve(here, '..', '..');   // deploy tree (default: the tree this script lives in)
        let landed = null, started = null;
        try { landed = landedAtGit(sha, repo); } catch (e) {}
        try { started = procStartMsWin(procRe); } catch (e) {}
        const iso = (ms) => ms ? new Date(ms).toISOString().slice(11, 19) + 'Z' : '?';
        if (alreadyLive({ landedMs: landed, procStartMs: started })) console.log(`✓ ${sha} already LIVE: landed ${iso(landed)}, ${f.proc || 'main'} process started ${iso(started)} — no restart needed`);
        else { console.log(`✗ ${sha} NOT live (landed ${iso(landed)}, ${f.proc || 'main'} started ${iso(started)}) — restart needed (take the lock first)`); process.exitCode = 1; }
    } else if (cmd === 'status') {
        const s = status();
        console.log(!s.actor ? 'free' : `${s.held ? 'HELD' : 'STALE (takeover allowed)'} by ${fmt(s)}`);
    } else {
        console.log('deploy-lock.mjs acquire --as <actor> --reason "..." | release --as <actor> | status | live <sha> [--proc main|botwatch]');
    }
}
