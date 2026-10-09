// ★ 必须是第一条 import：建目录、装 env 默认值、chdir 到用户层。
import './src/utils/bootstrap.js';

import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { existsSync, readFileSync } from 'fs';
import { homePath, appPath, HOME_DIR, APP_ROOT, SETTINGS_FILE } from './src/utils/paths.js';
import { readJsonSafe } from './src/utils/bootstrap.js';
import { profileKeyStatus, anyKeyConfigured } from './src/utils/keys.js';
import { runMigrations, migrateSettings } from './src/utils/migrate.js';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', { type: 'array', describe: 'List of agent profile paths' })
        .option('task_path', { type: 'string', describe: 'Path to task file to execute' })
        .option('task_id', { type: 'string', describe: 'Task ID to execute' })
        .option('doctor', { type: 'boolean', describe: '自检：检查路径/依赖/渲染器是否就绪后退出' })
        .option('panel-only', { type: 'boolean', describe: '只起控制面板，不自动拉起 bot（改完配置再在面板里点「启动 Bot」）' })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();

// ── 配置覆盖层 ────────────────────────────────────────────────────────────────
// settings.js 是默认值来源（跟随代码发行，不应被用户编辑）；控制面板把用户改动写进
// <包根>/settings.json，只存与默认值的差异。优先级：settings.js < settings.json < env < CLI
// ★settings 的迁移必须在**读取之前**跑，否则本次启动仍然用旧值（迁移只对下次生效）。
const settingsNotes = migrateSettings(SETTINGS_FILE);

const overlay = readJsonSafe(SETTINGS_FILE, null);
if (overlay && typeof overlay === 'object') {
    for (const [k, v] of Object.entries(overlay)) {
        if (k.startsWith('_')) continue;
        settings[k] = v;
    }
}

if (args.profiles) settings.profiles = args.profiles;

if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    } else {
        throw new Error('task_id is required when task_path is provided');
    }
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) settings.port = process.env.MINECRAFT_PORT;
if (process.env.MINDSERVER_PORT) settings.mindserver_port = process.env.MINDSERVER_PORT;
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) settings.profiles = JSON.parse(process.env.PROFILES);
if (process.env.INSECURE_CODING) settings.allow_insecure_coding = true;
if (process.env.BLOCKED_ACTIONS) settings.blocked_actions = JSON.parse(process.env.BLOCKED_ACTIONS);
if (process.env.MAX_MESSAGES) settings.max_messages = process.env.MAX_MESSAGES;
if (process.env.NUM_EXAMPLES) settings.num_examples = process.env.NUM_EXAMPLES;
if (process.env.LOG_ALL) settings.log_all_prompts = process.env.LOG_ALL;
if (process.env.SETTINGS_JSON) {
    try { Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON)); }
    catch (err) { console.error('Failed to parse environment variable for SETTINGS_JSON:', err); }
}

// ── profile 定位 ─────────────────────────────────────────────────────────────
// 用户层只有一份 bot.json。settings.profiles 里的相对路径先按用户层解析，
// 再按代码目录解析（兼容 profiles/xxx.json 这类随包资产）。
function resolveProfile(p) {
    if (typeof p !== 'string') return null;
    const cands = [homePath(p), appPath(p), p];
    for (const c of cands) if (existsSync(c)) return c;
    return null;
}

function defaultProfiles() {
    for (const name of ['bot.json', 'neko.json']) {
        if (existsSync(homePath(name))) return [homePath(name)];
    }
    return [];
}

let profilePaths = (settings.profiles || []).map(resolveProfile).filter(Boolean);
if (profilePaths.length === 0) profilePaths = defaultProfiles();

// ── 用户数据就地升级 ──────────────────────────────────────────────────────────
// 升级分发包时 app/ 会被换新，但 bot.json / settings.json / keys.json 是用户数据、
// 必须保留 —— 所以历史上写进这些文件的错误值，只能在启动时就地修。见 migrate.js。
runMigrations({ profile: profilePaths[0], preNotes: settingsNotes });

// ── 密钥就绪检查 ─────────────────────────────────────────────────────────────
// 密钥由控制面板 GUI 配置。密钥没到位时不要去拉 agent 子进程 —— 它会在 getKey 处抛错
// 退出，被 agent_process 判定"启动过快不再重启"，玩家看到的是一堆英文堆栈而不是引导。
//
// ★ 必须按 profile 实际用到的那家 provider 判断，不能只看"有没有配过任何密钥"。
//   实测过的反例：home 里配了 DeepSeek，而 bot.json 写的是 OpenAI 模型 —— 全局判断
//   为真 → 照常拉起 → 硬崩在 gpt.js 的 getKey('OPENAI_API_KEY')。

// 判断 bot 能不能开跑的逻辑收敛在 src/utils/keys.js 的 profileKeyStatus()，
// 面板（panel/keys_api.js）用的是同一份 —— 两边各写一套必然漂移。

// ── 前缀守卫 ─────────────────────────────────────────────────────────────────
// Minecraft 会把 "/" 开头的输入当成游戏内置命令拦下来，消息根本不进聊天频道 —— bot
// 一个字都收不到。默认值和迁移都已经改掉了，但环境变量/CLI/手改文件仍可能塞回来，
// 这里兜一道：绝不静默，否则表现是"在游戏里怎么喊都没反应"，极难自查。
if (typeof settings.chat_command_prefix === 'string' && settings.chat_command_prefix.startsWith('/')) {
    console.warn(
        [
            '',
            `⚠️  游戏内指令前缀是 "${settings.chat_command_prefix}"，以 "/" 开头 —— Minecraft 会把它当成`,
            '    游戏内置命令拦掉，bot 收不到你在游戏里说的话。',
            '    请在控制面板的「游戏连接」页改成 "@" 开头（例如 @neko）。',
            '',
        ].join('\n')
    );
}

function banner(lines) {
    const w = Math.max(...lines.map(l => [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
    console.log('\n' + '═'.repeat(w + 4));
    for (const l of lines) console.log('  ' + l);
    console.log('═'.repeat(w + 4) + '\n');
}

// ── --doctor 自检 ────────────────────────────────────────────────────────────
if (args.doctor) {
    const { skillDirs } = await import('./src/utils/paths.js');
    const fs = await import('fs');
    let fail = 0;
    const ok = (c, label, extra = '') => { console.log(`${c ? '  ok ' : ' FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!c) fail++; };

    console.log('\nmc-agent 自检\n');
    console.log(`  APP_ROOT  = ${APP_ROOT}`);
    console.log(`  HOME_DIR  = ${HOME_DIR}`);
    console.log(`  CWD       = ${process.cwd()}\n`);

    const dirs = skillDirs();
    let skillCount = 0;
    for (const d of dirs) {
        try { skillCount += fs.readdirSync(d).filter(f => f.endsWith('.js')).length; } catch { /* 目录不存在 */ }
    }
    ok(skillCount > 0, '热加载技能可读', `${skillCount} 个 (${dirs.join(' + ')})`);
    ok(existsSync(appPath('bots', 'execTemplate.js')), 'execTemplate.js 存在');
    ok(existsSync(appPath('profiles', 'defaults', '_default.json')), 'profiles/defaults 存在');
    ok(profilePaths.length > 0, 'bot profile 可定位', profilePaths.join(', ') || '未找到 bot.json');
    ok(existsSync(homePath('keys.json')), 'keys.json 存在');

    for (const mod of ['mineflayer', 'prismarine-viewer/viewer/lib/viewer.js', 'three', 'node-canvas-webgl/lib/index.js', 'minecraft-data']) {
        try { await import(mod); ok(true, `依赖可加载: ${mod}`); }
        catch (e) { ok(false, `依赖可加载: ${mod}`, e.message.split('\n')[0]); }
    }
    try {
        const { createCanvas } = await import('node-canvas-webgl/lib/index.js');
        const THREE = (await import('three')).default;
        const cv = createCanvas(64, 64);
        // eslint-disable-next-line no-new
        new THREE.WebGLRenderer({ canvas: cv });
        ok(true, 'headless-gl 渲染器可初始化（截图管线）');
    } catch (e) { ok(false, 'headless-gl 渲染器可初始化（截图管线）', e.message.split('\n')[0]); }

    // ── 以下是「用户配置」而非「安装包完整性」，只报告、不计入失败 ──────────────
    // 分发包按设计不带任何密钥（密钥走控制面板 GUI）。把它算成 FAIL 会让打包脚本的
    // 冒烟自检永远过不去，也会让玩家第一次跑 --doctor 就看到一片红。
    const info = (label, extra) => console.log(`  --   ${label}${extra ? '  — ' + extra : ''}`);
    console.log('');
    info('API 密钥', anyKeyConfigured() ? '已配置' : '尚未配置 —— 请在控制面板的「AI 配置」页填写');
    if (profilePaths.length > 0) {
        const pj = readJsonSafe(profilePaths[0], null);
        const st = pj ? profileKeyStatus(pj) : { ready: false, missing: [] };
        info('bot 当前用的供应商',
            st.ready ? '密钥齐了，可以启动'
                : st.missing.length ? '缺密钥: ' + st.missing.map(m => m.label).join('、')
                    : '还没选 —— 请在控制面板的「AI 配置」页选一个');
    }

    console.log(`\n${fail === 0 ? '安装包完整性检查全部通过。' : `${fail} 项未通过。`}\n`);
    process.exit(fail === 0 ? 0 : 1);
}

// ── 启动 ─────────────────────────────────────────────────────────────────────
// await: 端口可能因 Windows 保留段回退到别的值, 面板地址和 agent 回连都要用实际端口。
settings.mindserver_port = await Mindcraft.init(false, settings.mindserver_port, settings.auto_open_ui);

const panelUrl = `http://localhost:${settings.mindserver_port}`;

if (args.panelOnly) {
    // --panel-only：面板是现在唯一的配置入口，而改供应商/模型/密钥这件事本身要求
    // 「先能打开面板，但先别让 bot 进世界」。没有这个开关的话，配置齐全时一启动就直接进去了。
    banner([
        '只启动了控制面板，bot 没有进入游戏。',
        `请打开: ${panelUrl}`,
        '改完供应商/模型/密钥后，在页面上点「启动 Bot」让她进入世界。',
    ]);
} else if (profilePaths.length === 0) {
    banner(['找不到 bot 配置文件 (bot.json)。', `请确认它在: ${HOME_DIR}`, `控制面板: ${panelUrl}`]);
} else {
    // bot.json 是分发包里用户可见可编辑的文件 —— 用记事本"另存为"会带上 UTF-8 BOM，
    // 裸 JSON.parse 会直接抛。走 BOM-safe 读取。
    const profile = profilePaths[0];
    const profile_json = readJsonSafe(profile, null);

    if (!profile_json) {
        banner([`bot 配置文件读不出来: ${profile}`, '文件可能格式有误。可以在控制面板的「Bot 设定」页重新保存一次。', `控制面板: ${panelUrl}`]);
    } else {
        const st = profileKeyStatus(profile_json);
        if (!st.ready) {
            banner(st.missing.length === 0
                ? ['还没有选择 AI 供应商，bot 暂不启动。',
                   `请打开控制面板: ${panelUrl}`,
                   '在「AI 配置」页选好供应商、填入密钥并测试连接，然后点「启动 Bot」。']
                : [`还缺少这些供应商的密钥: ${st.missing.map(m => m.label).join('、')}`,
                   `请打开控制面板填写: ${panelUrl}`,
                   '填完点「测试连接」确认可用，再点「启动 Bot」。']);
        } else {
            settings.profile = profile_json;
            settings.profile_path = profile;
            Mindcraft.createAgent(settings);
            console.log(`控制面板: ${panelUrl}`);
        }
    }
    if (profilePaths.length > 1) {
        console.log(`（检测到多个 bot 配置，本版本只使用第一个：${profile}）`);
    }
}
