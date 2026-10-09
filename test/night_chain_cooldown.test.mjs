// T-0186 (监工: T-0185 推广到整条夜链): computeNightPlan 任意一档的 kind 在派发冷却中时, 必须落到下一档有效计划,
// 不能返回已冷却的 kind (否则提案被冷却过滤 → 整夜无夜计划)。链尾 SEAL_FORT 是物理下限终兜底 (冷却也照返, 不改 NONE)。
import test from 'node:test';
import assert from 'node:assert/strict';
const { pickFirstNotCooled, NIGHT_DECISION_KIND, nightDecisionCooled } = await import('../src/agent/framework/night_owner.js');

const mk = (decision, when = true, terminal = false) => ({ decision, when, terminal, build: () => ({ decision }) });
const CHAIN = () => [mk('GO_BED'), mk('SMELT_IRON'), mk('MINE_THROUGH_NIGHT'), mk('STONE_BOOTSTRAP'), mk('DIG_ONE_CAP'), mk('SEAL_FORT', true, true)];
const now = 1_000_000;

test('T-0186: 每一档单独被冷却 → 落到下一档, 绝不返回已冷却 kind', () => {
    const order = CHAIN().map(c => c.decision);
    for (let i = 0; i < order.length - 1; i++) {
        const cd = { [NIGHT_DECISION_KIND[order[i]]]: now + 60000 };
        const chain = CHAIN().map((c, j) => (j < i ? { ...c, when: false } : c));   // 前面几档条件不成立, 第 i 档条件成立但冷却
        const got = pickFirstNotCooled(chain, cd, now);
        assert.equal(got.decision, order[i + 1], `${order[i]} cooled → expect ${order[i + 1]}, got ${got.decision}`);
        assert.equal(nightDecisionCooled(got.decision, cd, now), false);
    }
});

test('T-0186: 前几档条件不成立 + 中间档冷却 → 跳到下一个条件成立且未冷却的档; 过期冷却不算', () => {
    const chain = [mk('GO_BED', false), mk('SMELT_IRON', false), mk('MINE_THROUGH_NIGHT'), mk('STONE_BOOTSTRAP'), mk('DIG_ONE_CAP'), mk('SEAL_FORT', true, true)];
    assert.equal(pickFirstNotCooled(chain, { DUSK_MINE_NIGHT: now + 1, NIGHT_STONE_BOOTSTRAP: now + 1 }, now).decision, 'DIG_ONE_CAP');
    assert.equal(pickFirstNotCooled(chain, { DUSK_MINE_NIGHT: now - 1 }, now).decision, 'MINE_THROUGH_NIGHT', 'expired cooldown ignored');
});

test('T-0186: 冷却档的懒条件不求值 (昂贵扫描不跑); 全部冷却 → 链尾 SEAL_FORT 终兜底', () => {
    let scanned = false;
    const chain = [{ decision: 'DIG_ONE_CAP', when: () => { scanned = true; return true; }, build: () => ({ decision: 'DIG_ONE_CAP' }) }, mk('SEAL_FORT', true, true)];
    const got = pickFirstNotCooled(chain, { NIGHT_DIG_ONE: now + 1, NIGHT_SEAL: now + 1 }, now);
    assert.equal(scanned, false);
    assert.equal(got.decision, 'SEAL_FORT');
    assert.equal(got.cooled, true);
});

test('T-0186: 决策→kind 映射与 world_model 夜 switch 一致', async () => {
    const fs = await import('node:fs');
    const wm = fs.readFileSync(new URL('../src/agent/framework/world_model.js', import.meta.url), 'utf8');
    for (const [dec, kind] of Object.entries(NIGHT_DECISION_KIND)) {
        const i = wm.indexOf(`case '${dec}':`);
        assert.ok(i > 0, `world_model has case '${dec}'`);
        const body = wm.slice(i, wm.indexOf('break;', i));
        assert.ok(body.includes(`TASK.${kind}`), `${dec} pushes ${kind}`);
    }
});
