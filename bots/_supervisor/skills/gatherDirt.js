// Hot-reloadable REAL skill: ★T-0262 补 (监工) 零镐黄昏前备料 — 徒手挖地表泥土 (草方块也掉泥土), 攒到封一个坑的量。
// 证据: 04:27:54Z 死亡 — 重生重建后包里零填充方块, 入夜 bunkerDown cap/seal 全失败; 死亡重生后的第一晚正是零镐, mineDown 下挖石头要镐。
// 有界: ≤count 块、≤maxMs; 只挖泥土类 (dirt / grass_block / coarse_dirt / rooted_dirt), 不碰石头。被打断即退 (unwind)。
// 返回: 本次多了填充 → true; 一块没挖到 → {failed} (kernel 冷却; 零镐冷却由 T-0259 钳到 45s)。
// Invoked via: {"skill":"gatherDirt","args":[{"count":8}]}  ctx = { skills, world, log }
import fs from 'fs';
import path from 'path';
import { sealFillerCount } from '../../../src/agent/framework/filler.js';

const PROG = path.resolve(process.cwd(), 'bots', '_supervisor', 'progress.txt');
const prog = (s) => { try { fs.appendFileSync(PROG, `[${new Date().toISOString()}] gatherDirt: ${s}\n`); } catch (e) {} };
const DIRT_BLOCKS = ['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt'];

export default async function gatherDirt(bot, ctx, opts = {}) {
    const { skills, world } = ctx;
    const want = (opts && Number.isFinite(opts.count)) ? opts.count : 8;
    const maxMs = (opts && opts.maxMs) || 60000;
    const t0 = Date.now();
    const filler = () => { try { return sealFillerCount(world.getInventoryCounts(bot)); } catch (e) { return 0; } };
    const f0 = filler();
    prog(`start filler=${f0} want=${want}`);
    for (let pass = 0; pass < 12 && filler() < want && Date.now() - t0 < maxMs; pass++) {
        if (bot.interrupt_code) { prog('interrupted — unwind'); break; }
        const before = filler();
        for (const b of DIRT_BLOCKS) {
            if (filler() >= want || bot.interrupt_code || Date.now() - t0 >= maxMs) break;
            try { await skills.collectBlock(bot, b, Math.max(1, want - filler())); } catch (e) {}
        }
        if (filler() <= before) break;   // 附近挖不到了, 别空转
    }
    const gained = filler() - f0;
    prog(`done filler ${f0}→${filler()} (+${gained}) in ${Math.round((Date.now() - t0) / 1000)}s`);
    return gained > 0 ? true : { failed: true, reason: 'no-dirt-nearby' };
}
