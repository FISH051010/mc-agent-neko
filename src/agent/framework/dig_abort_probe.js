// ★T-0260 dig-abort probe — one owner for the "who called bot.stopDigging()" diagnostic. Installed from modes.initModes at
// startup (every skill/reflex covered from the first dig) and re-entrantly from mineDown (same version → no double listener).
// Moved out of mineDown.js so chopWood & co. never need a static import of another skill to get it.
import fs from 'fs';
import path from 'path';

// v2 (10-11 05:30:41/44Z mobility "dig retry … Digging aborted" left no caller trace — only mineDown read _lastDigAbort back):
//   every abort writes one throttled "[dig-abort] <block> by=<caller frames> holder=<body owner> skill=<skill>" line itself.
//   Versioned: a newer hot-reloaded probe replaces the listener it stored (v1 was anonymous — it only records, left in place;
//   never removeAllListeners: mineflayer-pathfinder listens to diggingAborted too). opts.sink replaces the progress write (tests).
export const DIG_ABORT_PROBE_V = 2;
export function installDigAbortProbe(bot, { sink } = {}) {
    try {
        if (!bot || typeof bot.on !== 'function' || bot._digAbortProbe === DIG_ABORT_PROBE_V) return;
        if (bot._digAbortListener && typeof bot.removeListener === 'function') { try { bot.removeListener('diggingAborted', bot._digAbortListener); } catch (e) {} }
        bot._digAbortProbe = DIG_ABORT_PROBE_V;
        const fn = (block) => {
            try {
                const frames = String(new Error().stack || '').split('\n').slice(1).map(s => s.trim())
                    .filter(s => s && !/node_modules|node:internal|node:events|EventEmitter|installDigAbortProbe|\bemit\b|\bfn\b/.test(s))
                    .slice(0, 4).map(s => s.replace(/^at /, '').replace(/\(?[A-Za-z]:[\\/].*?[\\/](src|bots)[\\/]/, '($1/').replace(/^file:\/\/\/.*?[\\/](src|bots)[\\/]/, '$1/'));
                const blk = block ? `${block.name}@${block.position}` : '-';
                bot._lastDigAbort = { at: Date.now(), block: blk, by: frames.join(' < ') };
                if (Date.now() - (bot._digAbortLogAt || 0) < 2000) return;
                bot._digAbortLogAt = Date.now();
                const line = `[dig-abort] ${blk} by=${bot._lastDigAbort.by || '?'} holder=${(bot._bodyOwner && bot._bodyOwner.name) || '-'} skill=${bot._currentSkill || '-'} (T-0260)`;
                if (typeof sink === 'function') sink(line);
                else fs.appendFileSync(path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt'), `[${new Date().toISOString()}] ${line}\n`);
            } catch (e) {}
        };
        bot._digAbortListener = fn;
        bot.on('diggingAborted', fn);
    } catch (e) {}
}
