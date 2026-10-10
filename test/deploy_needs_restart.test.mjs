// 监工 (2026-10-10, T-0189 部署事故): 热加载的 quickMeal 导入了运行中进程未重载的 src/food_floor 新导出 → 导入即挂零日志。
// "skill + 它 import 的 src 一起改必须重启" 交给工具判定: deploy-lock.mjs needs-restart 按改到的文件分类。
import test from 'node:test';
import assert from 'node:assert/strict';
const { classifyRestart } = await import('../bots/_supervisor/deploy-lock.mjs');

test('needs-restart: 只动 skills/*.js → 热加载; test/docs/CHANGELOG 不算运行时', () => {
    const r = classifyRestart(['bots/_supervisor/skills/quickMeal.js', 'test/x.test.mjs', 'bots/_supervisor/CHANGELOG.md', 'docs/a.md']);
    assert.equal(r.hotOnly, true);
    assert.deepEqual(r.needs, []);
});

test('needs-restart: T-0189 那次 (quickMeal + src/food_floor + world_model) → 必须重启 main, 列出 src 原因文件', () => {
    const r = classifyRestart(['bots/_supervisor/skills/quickMeal.js', 'src/agent/framework/food_floor.js', 'src/agent/framework/world_model.js']);
    assert.equal(r.hotOnly, false);
    assert.deepEqual(r.targets, ['main']);
    assert.deepEqual(r.needs.map(n => n.file), ['src/agent/framework/food_floor.js', 'src/agent/framework/world_model.js']);
});

test('needs-restart: kernelDriver → main (re-arm); botwatch/ticket-server/watchdog 各自进程; CLI 脚本不需重启', () => {
    assert.deepEqual(classifyRestart(['bots/_supervisor/skills/kernelDriver.js']).targets, ['main']);
    assert.deepEqual(classifyRestart(['bots/_supervisor/botwatch-trackers.mjs']).targets, ['botwatch']);
    assert.deepEqual(classifyRestart(['bots/_supervisor/ticket-server.mjs']).targets, ['ticket-server']);
    assert.deepEqual(classifyRestart(['watchdog.ps1']).targets, ['watchdog']);
    const cli = classifyRestart(['bots/_supervisor/ticket.mjs', 'bots/_supervisor/deploy-lock.mjs']);
    assert.deepEqual(cli.needs, []);
    assert.equal(classifyRestart(['some/unknown/runtime.js']).targets[0], 'check', 'unknown → manual check, never silently hot');
});

test('needs-restart: patches/*.patch / package(-lock).json → reinstall (先 npm install 再重启), 不再漏判 (7a05fda T-0207)', () => {
    const r = classifyRestart(['patches/mineflayer-pathfinder+2.4.5.patch', 'bots/_supervisor/CHANGELOG.md', 'test/pathfinder_stop_residue.test.mjs']);
    assert.deepEqual(r.targets, ['reinstall']);
    assert.equal(r.hotOnly, false);
    assert.deepEqual(classifyRestart(['package-lock.json']).targets, ['reinstall']);
    assert.deepEqual(classifyRestart(['package.json']).targets, ['reinstall']);
});
