// T-0137: mineDown 的拒跑/abort 原因只进 bot 内部输出 → 18:43/18:49 3 连败冷却时 progress.txt 零行 mineDown 日志,
// 监工看不出是哪道闸。每次派发都必须在 progress.txt 留下 START 与 DONE(含 abort 原因)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('T-0137: mineDown 的 log_ 同时落 progress.txt, 且入口打 START', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
    fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
    const cwd = process.cwd(); process.chdir(home);
    try {
        const { progLine } = await import('../bots/_supervisor/skills/mineDown.js');
        progLine('DONE {"abort":"no floor support under 4,46,-16 (air)","failed":true}');
        const txt = fs.readFileSync(path.join(home, 'bots', '_supervisor', 'progress.txt'), 'utf8');
        assert.match(txt, /\[mineDown\] DONE .*no floor support/);
    } finally { process.chdir(cwd); }
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/mineDown.js', import.meta.url), 'utf8');
    assert.ok(/const log_ = \(m\) => \{ log\(bot, `\[mineDown\] \$\{m\}`\); progLine\(m\); \};/.test(src), 'log_ mirrors to progress.txt');
    assert.ok(/progLine\(`START /.test(src), 'entry START line');
});
