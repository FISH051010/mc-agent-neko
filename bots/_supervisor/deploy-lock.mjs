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
// acquire 失败 exit 1 并打印持有者; 超过 TTL (默认 15min) 的锁视为持有者已死, 可被接管 (会打印接管记录)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    } else if (cmd === 'status') {
        const s = status();
        console.log(!s.actor ? 'free' : `${s.held ? 'HELD' : 'STALE (takeover allowed)'} by ${fmt(s)}`);
    } else {
        console.log('deploy-lock.mjs acquire --as <actor> --reason "..." | release --as <actor> | status');
    }
}
