"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExplicitJournal = createExplicitJournal;
exports.createExplicitChat = createExplicitChat;
const cxn_catalog_cjs_1 = require("./cxn-catalog.cjs");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const key = (t) => JSON.stringify([t.agentId, t.sessionId]);
/** Local plaintext journal. A started operation is never retried automatically. */
function createExplicitJournal(file) {
    function read() { try {
        if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
            throw Error('journal symlink refused');
        const x = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        if (x.version !== 1 || !x.chats || typeof x.chats !== 'object')
            throw Error('invalid journal');
        return x;
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return { version: 1, chats: {} };
        throw e;
    } }
    function write(d) { try {
        if ((0, node_fs_1.lstatSync)(file).isSymbolicLink())
            throw Error('journal symlink refused');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    } const tmp = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`; try {
        (0, node_fs_1.writeFileSync)(tmp, JSON.stringify(d), { mode: 0o600, flag: 'wx' });
        const fd = (0, node_fs_1.openSync)(tmp, 'r');
        try {
            (0, node_fs_1.fsyncSync)(fd);
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
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
    function chat(d, t) { return d.chats[key(t)] ??= ({ mode: 'native', rows: [], operations: {} }); }
    return { get(t) { return chat(read(), t); }, update(t, fn) { const d = read(); fn(chat(d, t)); write(d); }, merge(t, rows) { const local = chat(read(), t).rows, seen = new Set(rows.map(r => r.id)); const all = [...rows]; let seq = rows.reduce((n, r) => typeof r.seq === 'number' && Number.isSafeInteger(r.seq) ? Math.max(n, r.seq) : n, 0); for (const r of local) {
            if (seen.has(r.id))
                continue;
            seen.add(r.id);
            const entry = { ...r, seq: ++seq };
            const i = all.findIndex(x => typeof x.timestampMs === 'number' && typeof r.timestampMs === 'number' && x.timestampMs > r.timestampMs);
            if (i < 0)
                all.push(entry);
            else
                all.splice(i, 0, entry);
        } return all; } };
}
function createExplicitChat(options) {
    const snapshots = new Map(), busy = new Set();
    function capture(t, rows, complete) { snapshots.set(key(t), { rows: structuredClone(rows), complete }); }
    function notice(t, nonce, text) { const row = { id: `route-status-${nonce}`, kind: 'notice', text, timestampMs: options.now() }; options.journal.update(t, c => { if (!c.rows.some(r => r.id === row.id))
        c.rows.push(row); }); if (!options.emit(t, [row]))
        throw Error('transcript unavailable'); }
    async function commandCore(method, args) {
        if (method !== 'sendPrompt' || !args.agentId || typeof args.prompt !== 'string' || !args.clientNonce)
            return;
        const p = args.prompt.trim(), match = /^\/cxn-(list|model|status)(?:\s+(.*))?$/.exec(p);
        if (!match)
            return;
        const t = { agentId: args.agentId, sessionId: args.sessionId ?? '' };
        if (!options.ready(t))
            throw Error('transcript unavailable');
        const prev = options.journal.get(t).operations[args.clientNonce];
        if (prev === 'complete')
            return { accepted: true };
        if (prev)
            throw Error('command already processed');
        const catalog = options.catalog;
        if (!catalog)
            throw Error('model catalog unavailable');
        let text = '';
        const cmd = match[1], arg = match[2]?.trim() ?? '';
        if (cmd === 'list') {
            if (arg)
                text = 'Usage: /cxn-list';
            else {
                const d = await catalog.refresh();
                text = `Models (${d.availability}; last sync: ${d.syncedAt === null ? 'never' : new Date(d.syncedAt).toISOString()}${catalog.isStale(d) ? '; stale' : ''}${d.error ? `; ${d.error}` : ''}):\n` + (d.models.length ? d.models.map(m => `${m.id}${m.displayName !== m.id ? ` — ${m.displayName}` : ''}${m.provider ? ` [${m.provider}]` : ''}`).join('\n') : 'No cached models.');
            }
        }
        else if (cmd === 'model') {
            const d = catalog.read();
            if (!arg)
                text = 'Usage: /cxn-model <exact model ID>. Use /cxn-list to refresh choices.';
            else if (!d.models.some(m => m.id === arg))
                text = `Unknown model: ${arg}. Use /cxn-list for exact IDs.`;
            else {
                options.journal.update(t, c => { c.model = arg; });
                text = `Selected ${arg} for this conversation${catalog.isStale(d) ? ' (cached model list is stale)' : ''}. Routing mode unchanged.`;
            }
        }
        else {
            const d = catalog.read(), c = options.journal.get(t), r = c.recent;
            const mode = options.scratchTarget?.(t) ? 'on (scratch text mode)' : c.mode === 'router' ? 'on (text mode)' : 'off (native)';
            text = `Router: ${mode}; model: ${c.model ?? 'gpt-6-luna'}; origin: ${cxn_catalog_cjs_1.ORIGIN}. Model list: ${d.availability}, checked ${d.checkedAt === null ? 'never' : new Date(d.checkedAt).toISOString()}, synced ${d.syncedAt === null ? 'never' : new Date(d.syncedAt).toISOString()}${catalog.isStale(d) ? ' (stale)' : ''}${d.error ? `; ${d.error}` : ''}. Recent inference: ${r ? `${r.success ? 'success' : 'failure'} at ${new Date(r.checkedAt).toISOString()}, ${r.durationMs} ms${r.usage ? `, tokens ${JSON.stringify(r.usage)}` : ''}` : 'none recorded'}. Router mode is text-only; native tools and hidden instructions are unavailable.`;
        }
        notice(t, args.clientNonce, text);
        options.journal.update(t, c => { c.operations[args.clientNonce] = 'complete'; });
        return { accepted: true };
    }
    async function send(method, args, signal) {
        if (method !== 'sendPrompt' || !args.agentId || typeof args.prompt !== 'string' || !args.clientNonce)
            return;
        const t = { agentId: args.agentId, sessionId: args.sessionId ?? '' }, k = key(t), mode = options.journal.get(t).mode, p = args.prompt.trim();
        if (p === '/router-on' || p === '/router-off') {
            if (!options.ready(t))
                throw Error('transcript unavailable');
            options.journal.update(t, c => { c.mode = p === '/router-on' ? 'router' : 'native'; });
            notice(t, args.clientNonce, p === '/router-on' ? 'Router text mode: visible text history only; native tools and hidden instructions are unavailable. Use /router-off for native tools.' : 'Native mode: locally routed turns may be missing from native context.');
            return { accepted: true };
        }
        const prior = options.journal.get(t).operations[args.clientNonce];
        if (prior === 'complete')
            return { accepted: true };
        if (prior === 'native') {
            snapshots.delete(k);
            return;
        }
        if (prior)
            throw Error('This turn has an uncertain or failed router attempt; send a new message to retry.');
        if (mode !== 'router') {
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'native'; });
            snapshots.delete(k);
            return;
        }
        if (args.attachmentPaths?.length || args.richText || args.replyToId) {
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'native'; });
            notice(t, args.clientNonce, 'Native route: attachments, formatted content, and replies are unsupported in router text mode; local-only turns may be absent from native context.');
            snapshots.delete(k);
            return;
        }
        if (!p)
            throw Error('empty text');
        if (!options.ready(t))
            throw Error('transcript unavailable');
        if (busy.has(k))
            throw Error('turn already in progress');
        const snap = snapshots.get(k);
        if (!snap?.complete)
            throw Error('Router text mode needs a complete visible transcript; reopen the conversation or use /router-off.');
        const rows = options.journal.merge(t, snap.rows), messages = [];
        for (const row of rows) {
            if (row.kind === 'notice')
                continue;
            if (row.kind !== 'message' || (row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string')
                throw Error('Router text mode cannot safely hydrate this transcript; use /router-off.');
            messages.push({ role: row.role, content: row.content });
        }
        busy.add(k);
        try {
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'started'; });
            const sig = signal ?? new AbortController().signal;
            sig.throwIfAborted();
            const selected = options.journal.get(t).model;
            if (selected && options.catalog && !options.catalog.read().models.some(m => m.id === selected))
                throw Error('Selected model no longer appears in the cached list; use /cxn-list and /cxn-model.');
            const answer = await options.complete([...messages, { role: 'user', content: args.prompt }], sig, t);
            sig.throwIfAborted();
            if (!answer.trim())
                throw Error('empty router response');
            const at = options.now();
            const output = [{ id: `route-user-${args.clientNonce}`, kind: 'message', role: 'user', content: args.prompt, clientNonce: args.clientNonce, timestampMs: at }, { id: `route-assistant-${args.clientNonce}`, kind: 'message', role: 'assistant', content: answer, timestampMs: at }];
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'complete'; c.rows.push(...output); });
            if (!options.emit(t, output))
                throw Error('transcript unavailable; completed response saved locally');
            return { accepted: true };
        }
        catch (e) {
            if (options.journal.get(t).operations[args.clientNonce] !== 'complete')
                options.journal.update(t, c => { c.operations[args.clientNonce] = 'failed'; });
            throw e;
        }
        finally {
            busy.delete(k);
        }
    }
    const pendingCommands = new Map();
    function command(method, args) { if (!args.agentId || !args.clientNonce)
        return commandCore(method, args); const k = JSON.stringify([args.agentId, args.sessionId ?? '', args.clientNonce]); const current = pendingCommands.get(k); if (current)
        return current; const p = commandCore(method, args); pendingCommands.set(k, p); void p.finally(() => pendingCommands.delete(k)).catch(() => { }); return p; }
    return { capture, send, command, invalidate(t) { snapshots.delete(key(t)); } };
}
