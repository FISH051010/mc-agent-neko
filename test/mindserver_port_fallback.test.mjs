import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mindcraftUrl = pathToFileURL(path.join(root, 'src', 'mindcraft', 'mindcraft.js')).href;

// Simulates the Windows winnat "excluded port range" failure: listening on any port in
// `blocked` fails with EACCES exactly the way the OS reports it, everything else is real.
function runChild (blocked, wanted) {
  const source = `
    import net from 'node:net';
    const blocked = new Set(${JSON.stringify(blocked)});
    const realListen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (port, ...rest) {
      if (blocked.has(Number(port))) {
        const err = Object.assign(new Error('listen EACCES: permission denied ::1:' + port), { code: 'EACCES', syscall: 'listen', port });
        process.nextTick(() => this.emit('error', err));
        return this;
      }
      return realListen.call(this, port, ...rest);
    };
    const Mindcraft = await import(${JSON.stringify(mindcraftUrl)});
    const port = await Mindcraft.init(false, ${wanted}, false);
    console.log('PORT=' + port);
    process.exit(0);
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout\n' + out + err)); }, 60000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

test('2026-10-09: mindserver port reserved by Windows (EACCES) falls back instead of crash-looping', async () => {
  // 65431 stands in for the reserved 8765; the first fallback (18765) may be busy on a dev
  // box running the real stack, so block it too and accept any later candidate.
  const r = await runChild([65431, 18765], 65431);
  assert.equal(r.code, 0, `child exited ${r.code}\n${r.out}\n${r.err}`);
  const m = r.out.match(/PORT=(\d+)/);
  assert.ok(m, `no PORT line\n${r.out}\n${r.err}`);
  const port = Number(m[1]);
  assert.notEqual(port, 65431);
  assert.notEqual(port, 18765);
  assert.ok(port > 0);
  assert.match(r.out + r.err, /被系统保留|无权限监听/);
});
