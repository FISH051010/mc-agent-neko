// Shared JSON-file reader for supervisor control/state files (sticky_skill.json, advisory.json, …).
// Pinned by test/bom_json.test.mjs (T-0116 / C251).
import fs from 'fs';

// Returns the parsed object, or null when the file is missing / unparseable.
export function readJsonFileSync(file, { onError } = {}) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
    // ★C251/T-0116: PowerShell Set-Content/Out-File writes UTF-8 WITH a BOM; JSON.parse chokes on it.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    try { return JSON.parse(raw); }
    catch (e) { if (onError) { try { onError(e); } catch (_) {} } return null; }
}

// ★perf 2026-07-09 (moved from modes.js): TTL-cached reader for the small supervisor state files re-read
// on the hot observe/decide ticks (advisory.json, migrate_state.json). Consumers only READ fields off the
// result, so a shared ~1.5s cache is safe. null on any read/parse failure (every call site null-guards).
const _jsonReadCache = new Map();   // path -> { t, v }
export function readJsonCached(path, ttlMs) {
    const now = Date.now();
    const c = _jsonReadCache.get(path);
    if (c && (now - c.t) < ttlMs) return c.v;
    const v = readJsonFileSync(path);
    _jsonReadCache.set(path, { t: now, v });
    return v;
}
