import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// T-0270: ensure-stack (SessionStart hook) launched watchdog.ps1 with Start-Process. On Windows a Start-Process child
// inherits the caller's Job Object, so the watchdog — and every main/bridge/botwatch it spawned — lived inside the
// Claude session that happened to run the hook. When that session ended its job was terminated: watchdog killed with
// no log line, main.js down 7 min (10-11 13:35→13:42) until another session's hook started a new one.
// Measured live: Start-Process child IsProcessInJob=True, Win32_Process.Create child IsProcessInJob=False (parent WmiPrvSE).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ensure = fs.readFileSync(path.join(root, 'bots', '_supervisor', 'ensure-stack.ps1'), 'utf8');
const code = ensure.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');

test('T-0270: ensure-stack launches watchdog via Win32_Process.Create (outside the session Job Object)', () => {
    assert.match(code, /Invoke-CimMethod\s+-ClassName\s+Win32_Process\s+-MethodName\s+Create/);
    assert.match(code, /CurrentDirectory\s*=\s*\$proj/, 'watchdog must start in the repo root');
});

test('T-0270: Start-Process is only the fallback when the CIM launch fails', () => {
    const cim = code.indexOf('Invoke-CimMethod');
    const sp = code.indexOf('Start-Process powershell');
    assert.ok(cim >= 0);
    if (sp >= 0) {
        assert.ok(sp > cim, 'Start-Process must come after the CIM attempt');
        assert.match(code, /ReturnValue\s*-ne\s*0|-not\s+\$launched/, 'fallback is gated on the CIM launch failing');
    }
});
