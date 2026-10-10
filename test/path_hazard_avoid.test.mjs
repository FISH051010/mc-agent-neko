// death #16 (2026-10-10 01:43:45, cause sweet_berry_bush): 被僵尸打到 hp4 后, 寻路冲刺穿过浆果丛 (每碰 1 伤),
// 01:43:30 已 hp<1, 01:43:45 migrate 一动再蹭一下即死。lib Movements.blocksToAvoid 只有 fire/cobweb/lava。
// 契约: 所有 Movements (子类构造钩 hardenMovements) 都把会伤人的可穿过方块当不安全格 → 绕开或挖掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { hardenMovements, _HARDEN_AVOID } from '../src/agent/library/skills.js';

test('T-0205 death #16: hardenMovements 把 sweet_berry_bush 等伤害方块加入 blocksToAvoid (不动 blocksCantBreak 语义)', () => {
    const registry = minecraftData('1.21.1');
    const mv = { blocksCantBreak: new Set(), blocksToAvoid: new Set([registry.blocksByName.fire.id]) };
    hardenMovements({ registry }, mv);
    for (const n of ['sweet_berry_bush', 'wither_rose', 'powder_snow']) {
        assert.ok(mv.blocksToAvoid.has(registry.blocksByName[n].id), n);
        assert.ok(!mv.blocksCantBreak.has(registry.blocksByName[n].id), `${n} stays breakable (a bush on the only route gets cut)`);
    }
    assert.ok(mv.blocksToAvoid.has(registry.blocksByName.fire.id), 'lib defaults kept');
    assert.ok(_HARDEN_AVOID.includes('sweet_berry_bush'));
});

test('T-0205 death #16: 子类构造钩覆盖所有 new pf.Movements (含热加载技能) — hardenMovements 在构造函数里调用', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/agent/library/skills.js', import.meta.url), 'utf8');
    const ctor = src.slice(src.indexOf('class _NoScaffoldMovements extends _PFMovements'), src.indexOf('safeToBreak(block)'));
    assert.match(ctor, /hardenMovements\(args\[0\], this\)/);
});
