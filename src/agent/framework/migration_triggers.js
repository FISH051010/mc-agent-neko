// ★T-0102 wood-barren relocate latch + ★T-0106 migration.recommend gate, extracted verbatim from
// modes.js's world-model migration block so test/migration_triggers.test.mjs can pin them
// (回归测试钉死). See the modes.js call site for the full rationale. No behavior change.

// One decision-tick of the wood-barren latch. State lives on bot._woodBarren* (as before).
// counts = world.getInventoryCounts(bot); p = bot position; picks = effective pick count.
export function woodBarrenTick(bot, { picks, counts, p, now }) {
    let woodBarren = false;
    const sticksN = counts['stick'] || 0;
    const planksN = Object.entries(counts).reduce((s, [n, v]) => s + (n.endsWith('_planks') ? v : 0), 0);
    const logsN = Object.entries(counts).reduce((s, [n, v]) => s + (/_(log|stem|hyphae|wood)$/.test(n) ? v : 0), 0);
    const woodlessForPick = picks < 1 && (planksN + logsN * 4 + sticksN) < 2;   // can't even make 2 sticks for a pick
    if (woodlessForPick) { if (!bot._woodBarrenSince) bot._woodBarrenSince = now; }
    else { bot._woodBarrenSince = 0; }                                          // has a pick or has wood → not barren-deadlocked
    const barrenMs = bot._woodBarrenSince ? now - bot._woodBarrenSince : 0;
    if (barrenMs >= 300000 && now - (bot._woodBarrenLatchAt || 0) > 300000) {
        bot._woodBarrenLatchAt = now;
        bot._woodBarrenOrigin = { x: Math.round(p.x), z: Math.round(p.z) };
    }
    if (bot._woodBarrenLatchAt && now - bot._woodBarrenLatchAt < 300000) {
        const o = bot._woodBarrenOrigin;
        const movedClear = o && Math.hypot(p.x - o.x, p.z - o.z) > 48;
        // woodBarren-2026-07-14 (yong-ling): woodBarren pan-ju zhi kan "bei-bao wu mu" bu kan "fu-jin you mei you shu".
        //   zhan sen-lin li kan-bu-dao shu (chopWood ka jiang-sheng/hei-ming-dan/ye-si da-duan) shi bao-kong 5min ye wu-pan barren.
        //   zha: shang-yi-pai di-biao you [jin(<=48b) qie xin-xian(<120s) de ke-da mu] = zhe-di zhen you shu, wen-ti zai kan-bu-dong fei mei shu ->
        //   bu pan barren(qing latch). zhen shu-xi-shu qun-xi(beach/desert) woodReach kong/yuan/jiu -> treeHere=false -> zhao-chang qian-xi.
        let treeHere = false;
        try {
            const _wr = bot._world && bot._world.landmarks && bot._world.landmarks.woodReach;
            treeHere = !!(_wr && Number.isFinite(_wr.dist) && _wr.dist <= 48 && Number.isFinite(_wr.age) && _wr.age < 120000);
        } catch (e) {}
        if (movedClear || picks >= 1 || treeHere) { bot._woodBarrenLatchAt = 0; bot._woodBarrenSince = 0; }   // recovered or relocated
        else woodBarren = true;
    }
    return woodBarren;
}

// recommend = day-gated; force triggers (stuckTerrain/woodBarren in a biome migrate.js wouldn't flee
// on its own) ride through migrate's cooldown, NON-force triggers (badBiome/inDeathZone) only off-cooldown.
export function migrationRecommend({ phase, badBiome, inDeathZone, stuckTerrain, woodBarren, migrateOnCooldown }) {
    const _forceRelocate = (stuckTerrain || woodBarren) && !badBiome && !inDeathZone;
    const _anyTrigger = badBiome || inDeathZone || stuckTerrain || woodBarren;
    return (phase === 'day') && (_forceRelocate || (_anyTrigger && !migrateOnCooldown));
}
