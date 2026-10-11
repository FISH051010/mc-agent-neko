#!/usr/bin/env node
// ticket — CLI over the resident ticket-server (localhost:48920). This is how an agent
// (a Claude subagent I spawn, OR a human's brand-new Claude session) gets up to speed and
// claims work WITHOUT colliding: every claim is serialized by the single-writer server, so
// "who owns T-0007" is consistent across every session.
//
// FRESH-SESSION ONBOARDING — a new agent runs ONE command and is ready:
//     node bots/_supervisor/ticket.mjs onboard
//
// Common:
//     ticket.mjs list [status]                 # default: active (open/claimed/in_progress/...)
//     ticket.mjs next                          # the top unclaimed ticket to work on
//     ticket.mjs show T-0007
//     ticket.mjs claim T-0007 --as claude-B    # atomic; fails if someone else holds it
//     ticket.mjs mine --as claude-B
//     ticket.mjs create --type seal-fail --sev high --title "..." [--detail "..."]
//     ticket.mjs update T-0007 --status fixed --note "C282 ..." [--commit <sha>]
//     ticket.mjs comment T-0007 "tried X, root cause is Y"
//
// Identity: pass --as <tag>, or set env TICKET_ACTOR. Pick a stable, UNIQUE tag per session
// (e.g. claude-A / claude-B / user) so claims don't clash.

import http from 'http';

const PORT = parseInt(process.env.TICKET_PORT || '48920', 10);
const HOST = '127.0.0.1';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (argv[i + 1] && !argv[i + 1].startsWith('--')) { flags[k] = argv[++i]; } else flags[k] = true; }
    else pos.push(a);
}
const actor = flags.as || process.env.TICKET_ACTOR || 'claude';

// ★10-11 (worker-death T-0288): `update --status duplicate --resolution …` printed "updated T-0288 → duplicate" while the
//   server had answered 400 and `--resolution` was silently dropped. Now: every command has an option whitelist (unknown →
//   error, exit 1), and every write checks the HTTP status (non-2xx → error with the server's reason, exit 1, no "updated").
const ALLOWED = {
    help: [], onboard: [], list: [], next: [], show: [],
    mine: ['as'], claim: ['as'], release: ['as'], comment: ['as'],
    create: ['as', 'type', 'sev', 'severity', 'title', 'detail'],
    update: ['as', 'status', 'note', 'commit', 'prediction', 'sev', 'of'],
};
function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function ok(r, what) {
    if (r.code >= 200 && r.code < 300) return true;
    const b = (r.body && typeof r.body === 'object') ? r.body : { error: String(r.body) };
    fail(`${what}: HTTP ${r.code} — ${b.error || JSON.stringify(b)}${Array.isArray(b.valid) ? ` (valid: ${b.valid.join(', ')})` : ''}`);
    return false;
}

function req(method, p, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request({ host: HOST, port: PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
            (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ code: res.statusCode, body: JSON.parse(d || '{}') }); } catch { resolve({ code: res.statusCode, body: d }); } }); });
        r.on('error', (e) => reject(e));
        if (data) r.write(data);
        r.end();
    });
}

const sevIcon = { critical: '🔴', high: '🟠', med: '🟡', low: '⚪' };
function line(t) {
    const who = t.claimedBy ? ` 👤${t.claimedBy}` : '';
    const occ = t.occurrences > 1 ? ` ×${t.occurrences}` : '';
    return `${t.id}  ${sevIcon[t.severity] || '·'} ${t.status.padEnd(11)} ${t.type.padEnd(13)} ${t.title}${occ}${who}`;
}

async function main() {
    try {
        if (!cmd || cmd === 'help') {
            console.log('ticket.mjs — commands: onboard | list [status] | next | show <id> | claim <id> --as X | mine --as X | create ... | update <id> --status S [--of T-xxxx] [--note ..] [--commit sha] | comment <id> "..."');
            console.log('statuses: open claimed in_progress fixed verifying | terminal: closed wontfix duplicate (--of T-xxxx)');
            return;
        }
        if (!ALLOWED[cmd]) return fail(`unknown command '${cmd}' (run: ticket.mjs help)`);
        const bad = Object.keys(flags).filter(k => !ALLOWED[cmd].includes(k));
        if (bad.length) return fail(`unknown option${bad.length > 1 ? 's' : ''} ${bad.map(k => '--' + k).join(' ')} for '${cmd}' (allowed: ${ALLOWED[cmd].map(k => '--' + k).join(' ') || 'none'})`);
        if (cmd === 'onboard') {
            const sum = (await req('GET', '/api/summary')).body;
            const active = (await req('GET', '/api/tickets?status=open-ish')).body;
            const unclaimed = active.filter(t => !t.claimedBy);
            console.log('═══ Neko ticket system — you are now onboarded ═══');
            console.log(`server: http://localhost:${PORT}  (web UI for humans at /)`);
            console.log(`totals: ${JSON.stringify(sum.byStatus)}`);
            console.log(`\nACTIVE tickets (${active.length}); UNCLAIMED (${unclaimed.length}):`);
            for (const t of active) console.log('  ' + line(t));
            console.log('\nTo take work:  node bots/_supervisor/ticket.mjs claim <id> --as <your-unique-tag>');
            console.log('Pick a UNIQUE tag (claude-A / claude-B / user) so claims don\'t collide across sessions.');
            console.log('Read docs/parallel-tickets.md for the full pipeline + deploy gate rules.');
            console.log('★RULE: every bug fix ships with a regression test in test/ (fails before the fix, passes after; name it "T-xxxx: ...").');
            console.log('        Run `npm test` before deploy. No pinning test = not `fixed`. See docs/parallel-tickets.md「回归测试钉死」.');
            console.log('★RULE: restart/re-arm only while holding the deploy lock: node bots/_supervisor/deploy-lock.mjs acquire --as <tag> --reason "..." → deploy → release. Comments are not a lock.');
            return;
        }
        if (cmd === 'list') {
            const status = pos[0] || 'open-ish';
            const ts = (await req('GET', `/api/tickets?status=${encodeURIComponent(status)}`)).body;
            if (!Array.isArray(ts)) return console.log(ts);
            console.log(`${ts.length} ticket(s) [${status}]:`);
            for (const t of ts) console.log('  ' + line(t));
            return;
        }
        if (cmd === 'next') {
            const ts = (await req('GET', '/api/tickets?status=open-ish')).body;
            const t = (Array.isArray(ts) ? ts : []).find(x => !x.claimedBy);
            if (!t) return console.log('no unclaimed active tickets 🎉');
            console.log('next up:\n  ' + line(t) + `\n  claim it: node bots/_supervisor/ticket.mjs claim ${t.id} --as <tag>`);
            return;
        }
        if (cmd === 'show') {
            const r = await req('GET', `/api/tickets/${pos[0]}`);
            if (!ok(r, `show ${pos[0]}`)) return;
            console.log(JSON.stringify(r.body, null, 2));
            return;
        }
        if (cmd === 'mine') {
            const ts = (await req('GET', `/api/tickets?claimedBy=${encodeURIComponent(actor)}`)).body;
            console.log(`${(ts || []).length} ticket(s) owned by ${actor}:`);
            for (const t of ts) console.log('  ' + line(t));
            return;
        }
        if (cmd === 'claim') {
            const r = await req('POST', `/api/tickets/${pos[0]}/claim`, { actor });
            if (r.code === 409) { console.log(`✗ already claimed by ${r.body.claimedBy} — pick another (run: ticket.mjs next)`); process.exitCode = 1; return; }
            if (!ok(r, `claim ${pos[0]}`)) return;
            console.log(`✓ ${pos[0]} claimed by ${actor}`);
            return;
        }
        if (cmd === 'release') { if (ok(await req('POST', `/api/tickets/${pos[0]}/release`, { actor }), `release ${pos[0]}`)) console.log(`released ${pos[0]}`); return; }
        if (cmd === 'comment') { if (ok(await req('POST', `/api/tickets/${pos[0]}/comment`, { actor, note: pos.slice(1).join(' ') }), `comment ${pos[0]}`)) console.log('commented'); return; }
        if (cmd === 'create') {
            const r = await req('POST', '/api/tickets', { source: 'manual', actor, type: flags.type, severity: flags.sev || flags.severity, title: flags.title || pos.join(' '), detail: flags.detail || '' });
            if (!ok(r, 'create')) return;
            console.log(`created ${r.body.ticket ? r.body.ticket.id : '?'}${r.body.merged ? ' (merged into existing)' : ''}`);
            return;
        }
        if (cmd === 'update') {
            if (flags.of && flags.status !== 'duplicate') return fail("--of only goes with --status duplicate");
            if (flags.status === 'duplicate' && (!flags.of || flags.of === true)) return fail('--status duplicate needs --of T-xxxx');
            const resolution = (flags.commit || flags.prediction) ? { commit: flags.commit || null, prediction: flags.prediction || null } : undefined;
            const r = await req('POST', `/api/tickets/${pos[0]}/update`, { actor, status: flags.status, note: flags.note, severity: flags.sev, resolution, duplicateOf: flags.of });
            if (!ok(r, `update ${pos[0]}`)) return;
            console.log(`updated ${pos[0]}${flags.status ? ' → ' + flags.status : ''}${r.body.duplicateOf ? ' of ' + r.body.duplicateOf : ''}`);
            return;
        }
    } catch (e) {
        console.error(`✗ ticket-server unreachable on :${PORT} (${e.message}). Start it: node bots/_supervisor/ticket-server.mjs`);
        process.exitCode = 2;
    }
}
main();
