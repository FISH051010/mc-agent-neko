import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../src/agent/settings.js';
import { addBrowserViewer } from '../src/agent/vision/browser_viewer.js';

test('disabled viewer leaves the existing bot and viewer untouched', async () => {
    Object.assign(settings, { render_bot_view: false });
    const viewer = { close() { assert.fail('disabled viewer must not close anything'); } };
    const bot = { viewer };
    await addBrowserViewer(bot);
    assert.equal(bot.viewer, viewer);
});

test('modern viewer rejects unsupported protocols before loading assets', async () => {
    Object.assign(settings, { render_bot_view: true, viewer_type: 'modern', viewer_port: 3000 });
    await assert.rejects(addBrowserViewer({ version: '1.21.6' }), /requires Minecraft 1.20.6/);
});

test('viewer rejects invalid or overflowing per-agent ports', async () => {
    Object.assign(settings, { render_bot_view: true, viewer_type: 'modern', viewer_port: 65535 });
    await assert.rejects(addBrowserViewer({ version: '1.20.6' }, 1), /Invalid viewer port/);
    settings.viewer_port = 0;
    await assert.rejects(addBrowserViewer({ version: '1.20.6' }), /Invalid viewer port/);
});
