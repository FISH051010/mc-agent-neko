// Replay-calibrate a botwatch detector against recorded history BEFORE it goes live (监工原则: 上线前先回放校准).
//
// Drives a detector exactly like botwatch does — one tick every 15s — feeding it the progress.txt lines that appeared
// since the previous tick, plus the vitals sample in effect (time-of-day → phase, sticky skill → driver, position).
// Ticks where the bot was not live (vitals older than STALE, like botwatch's STALE_SEC skip) or where progress.txt has
// no data for the period (log gaps) are skipped. Consecutive hits are merged into episodes; --triage prints, per
// episode, how far the body moved, the mobility states seen, and which log tags appeared — the evidence needed to
// call each hit a true positive or a false alarm.
//
//   node bots/_supervisor/tools/replay-detector.mjs idle-dispatch [--from 2026-10-09T00:00Z] [--to ...] [--triage]
//                                                                  [--sup <bots/_supervisor dir>]
//
// Adding a detector: write an adapter in ADAPTERS — create() returns { tick(now, lines, v) → hit|null } where hit is
// any object (optionally with .since / .label). Keep the detector's logic in botwatch-trackers.mjs so botwatch and the
// replay run the same code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIdleDispatchTracker, makeCooldownChurnTracker } from '../botwatch-trackers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TICK_MS = 15000;       // botwatch POLL_MS
export const STALE_MS = 90000;      // botwatch STALE_SEC
export const GAP_MS = 10 * 60000;   // no progress line for this long = log gap, not a quiet bot

// world_model.js / modes.js phase: day iff timeOfDay < 12000 (dusk 12000-13000, night 13000-23000, dawn ≥23000)
export const phaseOf = (tod) => (tod == null ? null : tod < 12000 ? 'day' : tod < 13000 ? 'dusk' : tod < 23000 ? 'night' : 'dawn');

export function loadHistory(supDir) {
    const vitals = fs.readFileSync(path.join(supDir, 'vitals.jsonl'), 'utf8').trim().split('\n')
        .map((l) => { try { const v = JSON.parse(l); return v && v.ts ? v : null; } catch { return null; } })
        .filter(Boolean).sort((a, b) => a.ts - b.ts);
    const progress = fs.readFileSync(path.join(supDir, 'progress.txt'), 'utf8').split(/\r?\n/)
        .map((l) => { const m = /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\]/.exec(l); return m ? { t: Date.parse(m[1]), l } : null; })
        .filter(Boolean);
    return { vitals, progress };
}

// Core loop. adapter.tick(now, newLines, vitalsSample) → hit|null. Returns merged episodes.
export function replay({ vitals, progress }, adapter, { from = -Infinity, to = Infinity, tick = TICK_MS } = {}) {
    if (!vitals.length) return [];
    const t0 = Math.max(vitals[0].ts, from), t1 = Math.min(vitals[vitals.length - 1].ts, to);
    let vi = 0, pi = 0;
    while (pi < progress.length && progress[pi].t < t0) pi++;   // botwatch starts at progress EOF
    const episodes = [];
    let cur = null;
    const close = () => { if (cur) { episodes.push(cur); cur = null; } };
    for (let now = t0; now <= t1; now += tick) {
        const lines = [];
        while (pi < progress.length && progress[pi].t <= now) lines.push(progress[pi++].l);
        while (vi + 1 < vitals.length && vitals[vi + 1].ts <= now) vi++;
        const v = vitals[vi];
        const live = v && now - v.ts <= STALE_MS;
        const covered = pi > 0 && now - progress[pi - 1].t < GAP_MS;
        if (!live || !covered) { adapter.ingestOnly?.(lines); close(); continue; }
        const hit = adapter.tick(now, lines, v);
        if (hit) {
            if (!cur) cur = { start: now, end: now, since: hit.since ?? now, first: hit, last: hit };
            else { cur.end = now; cur.last = hit; }
        } else close();
    }
    close();
    return episodes;
}

// Per-episode evidence: body span (blocks), mobility states, log-tag histogram between `since` and `end`.
export function triage(ep, { vitals, progress }) {
    const a = ep.since, b = ep.end;
    const vs = vitals.filter((v) => v.ts >= a && v.ts <= b);
    const span = vs.length ? Math.max(...['x', 'y', 'z'].map((k) => Math.max(...vs.map((v) => v[k])) - Math.min(...vs.map((v) => v[k])))) : null;
    const tags = {};
    for (const p of progress) {
        if (p.t < a || p.t > b) continue;
        const m = /^\[[^\]]+\]\s*(\[[^\]]+\]|[\w-]+:)/.exec(p.l);
        const k = m ? m[1] : '?';
        tags[k] = (tags[k] || 0) + 1;
    }
    return { span, mobility: [...new Set(vs.map((v) => v.mob))], tod: vs.length ? [vs[0].tod, vs[vs.length - 1].tod] : null, hp: vs.map((v) => v.hp), tags };
}

export const ADAPTERS = {
    'idle-dispatch': () => {
        const tr = makeIdleDispatchTracker();
        let lastBodyTs = 0;
        return {
            ingestOnly: (lines) => tr.ingest(lines),
            tick(now, lines, v) {
                tr.ingest(lines);
                if (v.ts > lastBodyTs) { tr.noteBody(v.ts, { x: v.x, y: v.y, z: v.z }); lastBodyTs = v.ts; }
                const h = tr.check(now, { phase: phaseOf(v.tod), driver: v.skill });
                return h ? { ...h, label: `${h.lastSkill}/${h.lastKind} idle=${Math.round(h.idleMs / 1000)}s` } : null;
            },
        };
    },
    'cooldown-churn': () => {
        const tr = makeCooldownChurnTracker();
        return {
            ingestOnly: (lines) => tr.ingest(lines),
            tick(now, lines) {
                tr.ingest(lines);
                const c = tr.churning(now);
                return c.length ? { label: c.map((x) => `${x.kind}×${x.count}`).join(' ') } : null;
            },
        };
    },
};

function main(argv) {
    const name = argv[0];
    if (!ADAPTERS[name]) { console.error(`usage: replay-detector.mjs <${Object.keys(ADAPTERS).join('|')}> [--from ISO] [--to ISO] [--triage] [--sup DIR]`); process.exit(2); }
    const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const supDir = opt('--sup') || path.resolve(HERE, '..');
    const hist = loadHistory(supDir);
    const from = opt('--from') ? Date.parse(opt('--from')) : -Infinity, to = opt('--to') ? Date.parse(opt('--to')) : Infinity;
    const eps = replay(hist, ADAPTERS[name](), { from, to });
    const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
    console.log(`${name}: replayed ${iso(Math.max(hist.vitals[0].ts, from))} → ${iso(Math.min(hist.vitals[hist.vitals.length - 1].ts, to))}  vitals=${hist.vitals.length} progress=${hist.progress.length}  episodes=${eps.length}`);
    for (const e of eps) {
        let line = `  HIT ${iso(e.start)} → ${iso(e.end)}  since=${iso(e.since)}  ${e.last.label || ''}`;
        if (argv.includes('--triage')) { const t = triage(e, hist); line += `  span=${t.span} mob=${t.mobility.join('/')} tod=${t.tod && t.tod.join('-')} tags=${JSON.stringify(t.tags)}`; }
        console.log(line);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
