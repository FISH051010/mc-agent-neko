// router.js — 控制面板的全部 /api 路由。
//
// 约定（前后端都按这个来，不要各自发明）：
//   · 成功 → {ok:true, ...}
//   · 失败 → {ok:false, error:"给玩家看的中文", code:"机器可读的短码"}
//   · 一切写操作过 guard.js 的四重门；读操作只查来源地址是不是本机。
//
// 与 mindserver 的解耦：本模块不 import mindserver.js（会绕成环，而且 mindserver
// 里的状态是模块级私有的），改由 mindserver 在 mountPanelApi 时把几个读写钩子传进来。

import express from 'express';
import fs from 'fs';
import { HOME_DIR, APP_ROOT } from '../../utils/paths.js';
import { guardRead, guardWrite, PANEL_TOKEN } from './guard.js';
import * as configStore from './config_store.js';
import * as keysApi from './keys_api.js';
import * as botStore from './bot_store.js';
import * as skinsApi from './skins.js';
import * as flagsApi from './flags.js';
import * as logbus from './logbus.js';
import * as mindcraft from '../mindcraft.js';

// ── 错误信封 ────────────────────────────────────────────────────────────────
function fail(res, status, error, code = 'BAD_REQUEST') {
    if (res.headersSent) return;
    res.status(status).json({ ok: false, error: String(error || '操作失败。'), code });
}

/** 包一层：抛出来的 Error.message 都是中文，直接当 error 回给面板。 */
function wrap(handler) {
    return (req, res, next) => {
        try {
            const r = handler(req, res, next);
            if (r && typeof r.then === 'function') {
                r.catch(err => fail(res, err?.status || 400, err?.message, err?.code));
            }
        } catch (err) {
            fail(res, err?.status || 400, err?.message, err?.code);
        }
    };
}

// ── 默认钩子（mindserver 没传时退化成"没有 agent"）────────────────────────────
const NOOP_HOOKS = {
    getPort: () => null,          // 实际监听端口（server.address().port），拿不到回落 settings
    getAgentsStatus: () => [],
    getAgentState: () => null,
    getScreenshot: () => null,
    getSkinStatus: () => null,
    sendToAgent: () => false,
};

/**
 * @param {import('express').Express} app
 * @param {object} hooks  见 NOOP_HOOKS
 */
export function mountPanelApi(app, hooks = {}) {
    const h = { ...NOOP_HOOKS, ...hooks };
    const api = express.Router();

    // 请求体：普通 JSON 256KB 封顶（面板最大的 payload 是人设提示词）
    api.use(express.json({ limit: '256kb' }));
    api.use(express.urlencoded({ extended: false, limit: '64kb' }));

    // 读闸：所有 /api 都要过
    api.use(guardRead);
    // 面板数据一律不许被缓存（改完刷新看到旧值是最难查的"没生效"）
    api.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    // 写闸：非 GET/HEAD
    api.use((req, res, next) => {
        if (req.method === 'GET' || req.method === 'HEAD') return next();
        return guardWrite(req, res, next);
    });

    // ── 启动信息 ────────────────────────────────────────────────────────────
    api.get('/bootstrap', wrap((req, res) => {
        const settings = configStore.effectiveValues();
        const keysReady = keysApi.anyKeyReady();
        res.json({
            ok: true,
            home: HOME_DIR,
            app: APP_ROOT,
            // 实际监听端口优先；拿不到才回落 settings 的配置值
            mindserverPort: (typeof h.getPort === 'function' ? h.getPort() : null)
                || Number(settings.mindserver_port) || 8080,
            firstRun: !keysReady,
            botName: botStore.botName(),
            keysReady,
            token: PANEL_TOKEN,   // 非浏览器客户端（curl/脚本）写接口时带 X-Panel-Token
        });
    }));

    api.get('/status', wrap((req, res) => {
        const name = botStore.botName();
        const agents = h.getAgentsStatus() || [];
        const me = agents.find(a => a.name === name) || null;
        const proc = mindcraft.getAgentProcess(name);
        res.json({
            ok: true,
            running: !!(proc && proc.running),
            inGame: !!(me && me.in_game),
            keysReady: keysApi.anyKeyReady(),
            agent: { name },
            state: h.getAgentState(name) || null,
        });
    }));

    // ── 服务商 / 密钥 ───────────────────────────────────────────────────────
    api.get('/providers', wrap((req, res) => {
        res.json({ ok: true, ...keysApi.panelView() });
    }));

    api.put('/providers/:key', wrap((req, res) => {
        const r = keysApi.saveProvider(req.params.key, req.body || {});
        res.json({ ok: true, key: req.params.key, ...r });
    }));

    api.post('/providers/:key/test', wrap(async (req, res) => {
        const r = await keysApi.testProvider(req.params.key, req.body || {});
        // 测试失败不是 HTTP 错误 —— 面板要拿到 message 展示，所以恒 200
        res.json({ ok: r.ok, code: r.code, message: r.message, models: r.models || [] });
    }));

    api.get('/providers/:key/models', wrap(async (req, res) => {
        const r = await keysApi.listModels(req.params.key);
        if (!r.ok) return fail(res, 400, r.error, r.code);
        res.json({ ok: true, models: r.models });
    }));

    // ── bot 配置 ────────────────────────────────────────────────────────────
    api.get('/bot', wrap((req, res) => {
        // skinStatus: agent 上报的"皮肤到底生效没有"。没有它的话，服务端缺 FabricTailor
        // 这种情况在面板上完全看不出来（皮肤页一切正常，游戏里就是不变）。
        res.json({ ok: true, ...botStore.describe(), skinStatus: h.getSkinStatus() || null });
    }));

    api.put('/bot', wrap((req, res) => {
        const r = botStore.update(req.body || {});
        res.json({ ok: true, changed: r.changed, restartRequired: r.restartRequired });
    }));

    // ── 皮肤 ────────────────────────────────────────────────────────────────
    api.get('/skins', wrap((req, res) => {
        res.json({ ok: true, ...skinsApi.listSkins() });
    }));

    api.post('/skins',
        express.raw({ type: ['image/png', 'application/octet-stream'], limit: '512kb' }),
        wrap((req, res) => {
            const name = req.get('X-Skin-Filename') || 'skin.png';
            const body = globalThis.Buffer.isBuffer(req.body) ? req.body : null;
            if (!body || !body.length) {
                return fail(res, 400, '没有收到图片内容。请重新选择一张 .png 皮肤文件。', 'EMPTY_BODY');
            }
            const r = skinsApi.saveSkin(body, name);
            res.json({ ok: true, ...r });
        }));

    api.put('/skins/current', wrap((req, res) => {
        const { file, variant } = req.body || {};
        if (!file) throw new Error('请先选一张皮肤。');
        const r = skinsApi.selectSkin(file, variant);
        res.json({ ok: true, ...r, restartRequired: true });
    }));

    api.delete('/skins/:file', wrap((req, res) => {
        const r = skinsApi.deleteSkin(req.params.file);
        res.json({ ok: true, ...r });
    }));

    api.get('/skins/:file/preview.png', wrap((req, res) => {
        const p = skinsApi.skinFilePath(req.params.file);
        if (!p) return fail(res, 404, '找不到这张皮肤。', 'NOT_FOUND');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(p).on('error', () => fail(res, 500, '读取皮肤失败。', 'READ_FAILED')).pipe(res);
    }));

    // ── 设置 ────────────────────────────────────────────────────────────────
    api.get('/settings', wrap((req, res) => {
        res.json({ ok: true, ...configStore.describe() });
    }));

    api.put('/settings', wrap((req, res) => {
        const r = configStore.update(req.body || {});
        res.json({ ok: true, changed: r.changed, restartRequired: r.restartRequired });
    }));

    // ── 环境开关 ────────────────────────────────────────────────────────────
    api.get('/flags', wrap((req, res) => {
        res.json({ ok: true, ...flagsApi.describe() });
    }));

    api.put('/flags', wrap((req, res) => {
        const r = flagsApi.update(req.body || {});
        res.json({ ok: true, changed: r.changed, restartRequired: true });
    }));

    // ── agent 生命周期 ──────────────────────────────────────────────────────
    async function ensureStarted() {
        const name = botStore.botName();
        if (!name) throw new Error('还没给 bot 起名字。请先到「Bot 设置」页填一个名字。');
        if (!keysApi.anyKeyReady()) {
            throw new Error('还没有配置任何 API 密钥，无法启动。请先到「API 配置」页填写并测试连接。');
        }
        const existing = mindcraft.getAgentProcess(name);
        if (existing) {
            // 已经注册过 → forceRestart 会把停着的那个重新拉起来
            mindcraft.startAgent(name);
            return { created: false };
        }
        const settings = configStore.launchSettings();
        settings.profile = botStore.loadProfile();
        settings.profile_path = botStore.profilePath();
        if (!settings.profile || !settings.profile.name) {
            throw new Error('bot 配置文件里没有名字。请先到「Bot 设置」页保存一次。');
        }
        const r = await mindcraft.createAgent(settings);
        if (!r || !r.success) throw new Error(`启动失败：${r?.error || '未知原因'}`);
        return { created: true };
    }

    api.post('/agent/start', wrap(async (req, res) => {
        logbus.push('收到「启动 Bot」请求', 'sys');
        const r = await ensureStarted();
        res.json({ ok: true, ...r });
    }));

    api.post('/agent/stop', wrap((req, res) => {
        const name = botStore.botName();
        logbus.push('收到「停止 Bot」请求', 'sys');
        mindcraft.stopAgent(name);
        res.json({ ok: true });
    }));

    api.post('/agent/restart', wrap(async (req, res) => {
        const name = botStore.botName();
        logbus.push('收到「重启 Bot」请求', 'sys');
        const proc = mindcraft.getAgentProcess(name);
        if (proc) { proc.forceRestart(); res.json({ ok: true }); return; }
        const r = await ensureStarted();
        res.json({ ok: true, ...r });
    }));

    api.post('/agent/chat', wrap((req, res) => {
        const message = String((req.body && req.body.message) || '').trim();
        if (!message) throw new Error('说点什么吧。');
        if (message.length > 4000) throw new Error('这段话太长了，请精简到 4000 字以内。');
        const name = botStore.botName();
        const sent = h.sendToAgent(name, 'send-message', { from: '控制面板', message });
        if (!sent) throw new Error('Bot 现在不在线，先点「启动 Bot」再说话。');
        logbus.push(`你 → ${name}: ${message}`, 'chat');
        res.json({ ok: true });
    }));

    // ── 日志 / 画面 ─────────────────────────────────────────────────────────
    api.get('/logs', wrap((req, res) => {
        const r = logbus.since(req.query.since);
        res.json({ ok: true, seq: r.seq, lines: r.lines });
    }));

    api.get('/screenshot/latest.jpg', wrap((req, res) => {
        const shot = h.getScreenshot();
        if (!shot || !shot.buf || !shot.buf.length) {
            return fail(res, 404, '暂时还没有画面。Bot 进入游戏后稍等几秒。', 'NO_SCREENSHOT');
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Screenshot-Time', String(shot.t || 0));
        res.end(shot.buf);
    }));

    // ── 兜底 ────────────────────────────────────────────────────────────────
    api.use((req, res) => fail(res, 404, `没有这个接口：${req.method} ${req.originalUrl}`, 'NO_ROUTE'));

    // body-parser 的报错（JSON 语法错、超限）也要用中文信封回，别漏成 HTML 错误页
    api.use((err, req, res, _next) => {
        if (err && (err.type === 'entity.too.large' || err.status === 413)) {
            return fail(res, 413, '提交的内容太大了。皮肤不能超过 512 KB，其他设置不能超过 256 KB。', 'TOO_LARGE');
        }
        if (err && err.type === 'entity.parse.failed') {
            return fail(res, 400, '提交的数据格式不对（不是合法的 JSON）。', 'BAD_JSON');
        }
        console.error('[panel] 接口异常:', err?.stack || err);
        return fail(res, 500, `服务器内部错误：${err?.message || err}`, 'INTERNAL');
    });

    app.use('/api', api);
    return api;
}

export default { mountPanelApi };
