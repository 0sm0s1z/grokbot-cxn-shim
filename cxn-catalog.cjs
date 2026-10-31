"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORIGIN = void 0;
exports.keyFromFile = keyFromFile;
exports.discoverModels = discoverModels;
exports.createCatalog = createCatalog;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
exports.ORIGIN = process.env.CXN_ROUTER_ORIGIN ?? 'https://router.example';
const origin = new URL(exports.ORIGIN);
if (origin.protocol !== 'https:' || origin.origin !== exports.ORIGIN)
    throw Error('CXN_ROUTER_ORIGIN must be an HTTPS origin');
const empty = () => ({ version: 1, models: [], syncedAt: null, checkedAt: null, availability: 'unknown', error: null });
function keyFromFile() { const file = (0, node_fs_1.readFileSync)((0, node_path_1.join)((0, node_os_1.homedir)(), '.config', 'cxn.env'), 'utf8'); const key = /^CXN_API_KEY=(.+)$/m.exec(file)?.[1]?.trim(); if (!key)
    throw Error('key unavailable'); return key; }
async function discoverModels() { const response = await fetch(`${exports.ORIGIN}/v1/models`, { headers: { authorization: `Bearer ${keyFromFile()}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }); if (!response.ok)
    throw Error(`HTTP ${response.status}`); return response.json(); }
function createCatalog(file, discover = discoverModels, now = Date.now) {
    function read() { try {
        if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
            throw Error('cache symlink refused');
        const d = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        if (d.version !== 1 || !Array.isArray(d.models))
            throw Error('invalid model cache');
        return d;
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return empty();
        throw e;
    } }
    function write(data) { try {
        if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
            throw Error('cache symlink refused');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    } const tmp = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`; try {
        (0, node_fs_1.writeFileSync)(tmp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
        (0, node_fs_1.renameSync)(tmp, file);
    }
    finally {
        try {
            (0, node_fs_1.unlinkSync)(tmp);
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
    } }
    let pending;
    async function refresh() { if (pending)
        return pending; pending = (async () => { const before = read(), checkedAt = now(); try {
        const response = await discover();
        if (!response || !Array.isArray(response.data))
            throw Error('invalid model list');
        const seen = new Set(), models = [];
        for (const item of response.data) {
            if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 256 || seen.has(item.id))
                continue;
            seen.add(item.id);
            models.push({ id: item.id, displayName: typeof item.display_name === 'string' ? item.display_name : typeof item.name === 'string' ? item.name : item.id, ...typeof item.owned_by === 'string' ? { provider: item.owned_by } : {} });
        }
        const next = { version: 1, models, syncedAt: checkedAt, checkedAt, availability: 'available', error: null };
        write(next);
        return next;
    }
    catch (e) {
        const message = e instanceof Error && /^HTTP \d{3}$/.test(e.message) ? e.message : 'model discovery failed';
        const next = { ...before, checkedAt, availability: 'unavailable', error: message };
        write(next);
        return next;
    } })(); try {
        return await pending;
    }
    finally {
        pending = undefined;
    } }
    return { read, refresh, isStale: (d) => d.syncedAt === null || now() - d.syncedAt > 3600000 };
}
