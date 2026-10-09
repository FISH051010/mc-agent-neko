// T-0138: 背包圆石 144 + 原木 12 + 0 台 → smeltSafe 造不出熔炉(3×3 要台)直接退出, GET_IRON_TOOLS/GET_ARMOR 各 3 连败冷却
// (实录 10-10 18:57:06Z)。技能层必须自给自足: 缺台且有木料 → 先折板造随身台, 再造炉。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
fs.mkdirSync(path.join(home, 'bots', '_supervisor'), { recursive: true });
process.chdir(home);
const { ensureCarriedTable } = await import('../bots/_supervisor/skills/smeltSafe.js');

function fakes(inv) {
    const skills = { craftRecipeLocal: async (_b, name, n) => {
        if (name === 'spruce_planks' && inv.spruce_log > 0) { inv.spruce_log -= n; inv.spruce_planks = (inv.spruce_planks || 0) + 4 * n; return true; }
        if (name === 'crafting_table' && (inv.spruce_planks || 0) >= 4) { inv.spruce_planks -= 4; inv.crafting_table = 1; return true; }
        return false; } };
    const world = { getInventoryCounts: () => ({ ...inv }), getNearestBlock: () => null };
    return { skills, world };
}

test('T-0138: 18:57 现场 (原木 12, 板 2, 0 台) → 先造随身台 (熔炉的 3×3 前置)', async () => {
    const inv = { cobblestone: 144, spruce_log: 12, spruce_planks: 2, raw_iron: 4 };
    assert.equal(await ensureCarriedTable({}, fakes(inv)), true);
    assert.equal(inv.crafting_table, 1);
});

test('T-0138: 无木料则如实返回 false; 已有台不重复造', async () => {
    assert.equal(await ensureCarriedTable({}, fakes({ cobblestone: 144 })), false);
    const inv = { crafting_table: 1, spruce_log: 3 };
    assert.equal(await ensureCarriedTable({}, fakes(inv)), true);
    assert.equal(inv.spruce_log, 3, 'no wood spent');
});

test('T-0138: smeltSafe 在 craftRecipeLocal(furnace) 之前调用 ensureCarriedTable', () => {
    const src = fs.readFileSync(new URL('../bots/_supervisor/skills/smeltSafe.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export default async function smeltSafe'));
    assert.ok(body.indexOf('ensureCarriedTable(') > 0 && body.indexOf('ensureCarriedTable(') < body.indexOf("craftRecipeLocal(bot, 'furnace'"));
});
