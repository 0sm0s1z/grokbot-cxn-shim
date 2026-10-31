"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExplicitJournal = createExplicitJournal;
exports.isPlainRichText = isPlainRichText;
exports.visibleMessage = visibleMessage;
exports.createExplicitChat = createExplicitChat;
const cxn_ui_cjs_1 = require("./cxn-ui.cjs");
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
    return { getGlobalMode() { return read().globalMode ?? 'selective'; }, setGlobalMode() { const d = read(); d.globalMode = 'selective'; write(d); }, get(t) { return chat(read(), t); }, update(t, fn) { const d = read(); fn(chat(d, t)); write(d); }, merge(t, rows) { const local = chat(read(), t).rows, seen = new Set(rows.map(r => r.id)); const all = [...rows]; let seq = rows.reduce((n, r) => typeof r.seq === 'number' && Number.isSafeInteger(r.seq) ? Math.max(n, r.seq) : n, 0); for (const r of local) {
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
/** Accept formatting metadata only when it is provably the same plain text. */
function isPlainRichText(value, prompt) {
    if (value === undefined || value === null || value === '')
        return true;
    if (typeof value !== 'string')
        return false;
    try {
        const doc = JSON.parse(value);
        if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content) || Object.keys(doc).some(k => k !== 'type' && k !== 'content'))
            return false;
        const paragraphs = [];
        for (const node of doc.content) {
            if (!node || node.type !== 'paragraph' || Object.keys(node).some(k => k !== 'type' && k !== 'content') || !(node.content === undefined || Array.isArray(node.content)))
                return false;
            let line = '';
            for (const leaf of node.content ?? []) {
                if (!leaf || leaf.type !== 'text' || typeof leaf.text !== 'string' || Object.keys(leaf).some(k => k !== 'type' && k !== 'text'))
                    return false;
                line += leaf.text;
            }
            paragraphs.push(line);
        }
        return paragraphs.join('\n') === prompt;
    }
    catch {
        return false;
    }
}
/** Hydrate visible text and explicitly skipped questions; reject other structured events. */
function visibleMessage(row) {
    if (row.kind === 'notice' || row.localControl === true)
        return undefined;
    if (row.kind === 'message' && (row.role === 'user' || row.role === 'assistant') && typeof row.content === 'string')
        return { role: row.role, content: row.content };
    if (row.kind === 'send-message' && row.message && typeof row.message === 'object') {
        const m = row.message;
        if (m.type === 'text' && typeof m.content === 'string')
            return { role: 'assistant', content: m.content };
        if (m.type === 'widget' && row.widgetSkipped === true && m.widget && typeof m.widget === 'object') {
            const w = m.widget;
            if (typeof w.prompt === 'string' && Array.isArray(w.options) && w.options.every(x => x && typeof x === 'object' && typeof x.label === 'string'))
                return { role: 'assistant', content: `${w.prompt}\nOptions: ${w.options.map(x => x.label).join('; ')}\n[Question dismissed without a selection.]` };
        }
    }
    return null;
}
function createExplicitChat(options) {
    const snapshots = new Map(), busy = new Set();
    function migrateLegacy(t) { options.journal.update(t, c => { if (!c.legacyMigrated) {
        if (c.mode === 'native')
            c.mode = 'router';
        c.legacyMigrated = true;
    } }); }
    function capture(t, rows, complete) { snapshots.set(key(t), { rows: structuredClone(rows), complete }); }
    function notice(t, nonce, text, prompt) { const timestampMs = options.now(), rows = [...prompt === undefined ? [] : [{ id: `route-user-${nonce}`, kind: 'message', role: 'user', content: prompt, clientNonce: nonce, timestampMs, localControl: true }], { id: `route-status-${nonce}`, kind: 'message', role: 'assistant', content: text, timestampMs, localControl: true }]; options.journal.update(t, c => { for (const row of rows)
        if (!c.rows.some(r => r.id === row.id))
            c.rows.push(row); if (prompt !== undefined)
        c.operations[nonce] = 'complete'; }); if (!options.emit(t, rows))
        throw Error('Transcript unavailable; the response is saved locally. Reopen the chat.'); }
    async function commandCore(method, args) {
        if (method !== 'sendPrompt' || !args.agentId || typeof args.prompt !== 'string' || !args.clientNonce)
            return;
        const p = args.prompt.trim(), match = /^\/cxn-([^\s]*)(?:\s+([\s\S]*))?$/.exec(p);
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
        const cmd = match[1], arg = match[2]?.trim() ?? '';
        const help = '**Constellation commands**\n\n- `/cxn-list` — browse available models\n- `/cxn-model <name or alias>` — choose a model\n- `/cxn-status` — see this chat’s route\n- `/cxn-mode selective` — use per-chat opt-in\n- `/router-on` / `/router-off` — change this chat’s route\n- `/cxn-help` — show this help\n\nExample: `/cxn-model gpt-6-luna`\n\nRouter mode handles text only; native tools remain available in native mode.';
        if (cmd === 'help' || !['list', 'model', 'status', 'mode'].includes(cmd)) {
            notice(t, args.clientNonce, (cmd === 'help' ? '' : 'Unknown command.\n\n') + help, args.prompt);
            return { accepted: true };
        }
        if (cmd === 'mode') {
            const text = arg === 'selective' ? (options.journal.setGlobalMode(), 'Global mode: selective. Only opted-in chats route through Constellation. Routing choices are unchanged.') : 'Usage: /cxn-mode selective';
            notice(t, args.clientNonce, text, args.prompt);
            return { accepted: true };
        }
        const catalog = options.catalog;
        if (!catalog)
            throw Error('model catalog unavailable');
        let text = '';
        if (cmd === 'list') {
            if (arg)
                text = 'Usage: `/cxn-list`';
            else {
                const d = await catalog.refresh(), c = options.journal.get(t), choices = (0, cxn_ui_cjs_1.modelChoices)(d.models);
                text = `**Available models**${d.availability === 'unavailable' ? ' · refresh failed' : ''}${catalog.isStale(d) ? ' · stale cache' : ''}\n\n` + (choices.length ? choices.map(m => `- ${m.id === c.model ? '✓ ' : ''}${m.label} — \`${m.alias}\``).join('\n') : 'No models available. Try `/cxn-list` again.') + '\n\nChoose a name or alias with `/cxn-model <choice>`.';
            }
        }
        else if (cmd === 'model') {
            const d = catalog.read(), matches = (0, cxn_ui_cjs_1.findModel)(d.models, arg);
            if (!arg)
                text = 'Choose a model with `/cxn-model <name or alias>`. Use `/cxn-list` to see choices.';
            else if (matches.length === 0)
                text = 'Model not found. Use `/cxn-list` to see available choices.';
            else if (matches.length > 1)
                text = 'That name matches multiple models. Choose an alias:\n\n' + matches.map(m => `- ${m.label} — \`${m.alias}\``).join('\n');
            else {
                const m = matches[0];
                options.journal.update(t, c => { c.model = m.id; });
                text = `Model selected: **${m.label}**${catalog.isStale(d) ? ' (cached list)' : ''}. This chat’s route is unchanged.`;
            }
        }
        else {
            const d = catalog.read(), c = options.journal.get(t), r = c.recent, choice = (0, cxn_ui_cjs_1.modelChoices)(d.models).find(m => m.id === (c.model ?? 'gpt-6-luna')), active = c.mode === 'router', snapshot = snapshots.get(key(t)), supported = !!snapshot?.complete && options.journal.merge(t, snapshot.rows).every(row => visibleMessage(row) !== null), recent = r ? `${r.success ? 'Succeeded' : 'Failed'} ${(0, cxn_ui_cjs_1.prettyWhen)(r.checkedAt, options.now())} · ${(0, cxn_ui_cjs_1.prettyDuration)(r.durationMs)}${r.usage?.total_tokens !== undefined ? ` · ${r.usage.total_tokens} tokens` : ''}` : 'None yet';
            text = `**Constellation status**\n\n- Mode: ${options.journal.getGlobalMode()}\n- This chat: ${active ? 'opted in' : 'not opted in'}\n- Route: ${active ? (supported ? 'Router for eligible text' : 'Router selected; history needs review') : 'Native'}\n- Model: ${choice?.label ?? c.model ?? 'gpt-6-luna'}\n- Last inference: ${recent}\n- Model list: ${d.availability === 'available' ? 'reachable' : d.availability === 'unavailable' ? 'refresh failed' : 'not checked'} · synced ${(0, cxn_ui_cjs_1.prettyWhen)(d.syncedAt, options.now())}${catalog.isStale(d) ? ' (stale)' : ''}\n\nRouter mode is text-only; use native mode for tools.`;
        }
        notice(t, args.clientNonce, text, args.prompt);
        return { accepted: true };
    }
    async function send(method, args, signal) {
        if (method !== 'sendPrompt' || !args.agentId || typeof args.prompt !== 'string' || !args.clientNonce)
            return;
        const t = { agentId: args.agentId, sessionId: args.sessionId ?? '' }, k = key(t), mode = options.journal.get(t).mode, p = args.prompt.trim();
        if (p === '/router-on' || p === '/router-off') {
            if (options.journal.get(t).operations[args.clientNonce] === 'complete')
                return { accepted: true };
            if (!options.ready(t))
                throw Error('transcript unavailable');
            options.journal.update(t, c => { c.mode = p === '/router-on' ? 'router' : 'native'; });
            notice(t, args.clientNonce, p === '/router-on' ? 'Router text mode: visible text history only; native tools and hidden instructions are unavailable. Use /router-off for native tools.' : 'Native mode: locally routed turns may be missing from native context.', args.prompt);
            return { accepted: true };
        }
        const prior = options.journal.get(t).operations[args.clientNonce];
        if (prior === 'started') {
            if (!busy.has(k)) {
                notice(t, args.clientNonce, 'The previous router request did not finish. Send a new message to retry.');
                options.journal.update(t, c => { c.operations[args.clientNonce] = 'failed'; });
            }
            return { accepted: true };
        }
        if (prior === 'complete' || prior === 'failed')
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
        if (args.attachmentPaths?.length || !isPlainRichText(args.richText, args.prompt) || args.replyToId || args.replySessionId || args.replyQuote || args.fileReference) {
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'native'; });
            notice(t, args.clientNonce, 'Native route: attachments, formatted content, and replies are unsupported in router text mode; local-only turns may be absent from native context.');
            snapshots.delete(k);
            return;
        }
        if (!p)
            throw Error('empty text');
        if (!options.ready(t))
            throw Error('transcript unavailable');
        if (busy.has(k)) {
            notice(t, args.clientNonce, 'A router reply is already in progress. Wait for it, then send your message again.', args.prompt);
            return { accepted: true };
        }
        const snap = snapshots.get(k);
        if (!snap?.complete) {
            notice(t, args.clientNonce, 'This chat’s history is incomplete. Reopen the chat and send a new message, or use `/router-off` for native mode.', args.prompt);
            return { accepted: true };
        }
        const rows = options.journal.merge(t, snap.rows), messages = [];
        for (const row of rows) {
            const message = visibleMessage(row);
            if (message === null) {
                notice(t, args.clientNonce, 'This chat contains content router text mode cannot use safely. Use `/router-off` for native mode, or start a text-only chat.', args.prompt);
                return { accepted: true };
            }
            if (message)
                messages.push(message);
        }
        const selected = options.journal.get(t).model;
        if (selected && options.catalog && !options.catalog.read().models.some(m => m.id === selected)) {
            notice(t, args.clientNonce, 'The selected model is no longer in the model list. Use `/cxn-list` and select another model with `/cxn-model`.', args.prompt);
            return { accepted: true };
        }
        const sig = signal ?? new AbortController().signal;
        sig.throwIfAborted();
        busy.add(k);
        const at = options.now(), user = { id: `route-user-${args.clientNonce}`, kind: 'message', role: 'user', content: args.prompt, clientNonce: args.clientNonce, timestampMs: at }, pending = { id: `route-assistant-${args.clientNonce}`, kind: 'message', role: 'assistant', content: 'Waiting for the router…', timestampMs: at, localControl: true };
        try {
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'started'; c.rows.push(user, pending); });
            if (!options.emit(t, [user, pending]))
                throw Error('Transcript unavailable; reopen the chat.');
        }
        catch (e) {
            busy.delete(k);
            throw e;
        }
        void (async () => { try {
            const answer = await options.complete([...messages, { role: 'user', content: args.prompt }], sig, t);
            sig.throwIfAborted();
            if (!answer.trim())
                throw Error('empty response');
            const row = { id: `route-assistant-${args.clientNonce}`, kind: 'message', role: 'assistant', content: answer, timestampMs: options.now() };
            options.journal.update(t, c => { c.operations[args.clientNonce] = 'complete'; const i = c.rows.findIndex(r => r.id === row.id); if (i < 0)
                c.rows.push(row);
            else
                c.rows[i] = row; });
            if (!options.update?.(t, row))
                options.emit(t, [row]);
        }
        catch (e) {
            const row = { id: `route-assistant-${args.clientNonce}`, kind: 'message', role: 'assistant', content: sig.aborted ? 'Router request canceled. Send a new message to try again.' : 'Router request failed. Check `/cxn-status`, then send a new message to retry.', timestampMs: options.now(), localControl: true };
            try {
                options.journal.update(t, c => { c.operations[args.clientNonce] = 'failed'; const i = c.rows.findIndex(r => r.id === row.id); if (i < 0)
                    c.rows.push(row);
                else
                    c.rows[i] = row; });
                if (!options.update?.(t, row))
                    options.emit(t, [row]);
            }
            catch { }
        }
        finally {
            busy.delete(k);
        } })();
        return { accepted: true };
    }
    const pendingCommands = new Map();
    function command(method, args) { if (!args.agentId || !args.clientNonce)
        return commandCore(method, args); const k = JSON.stringify([args.agentId, args.sessionId ?? '', args.clientNonce]); const current = pendingCommands.get(k); if (current)
        return current; const p = commandCore(method, args); pendingCommands.set(k, p); void p.finally(() => pendingCommands.delete(k)).catch(() => { }); return p; }
    return { capture, send, command, migrateLegacy, invalidate(t) { snapshots.delete(key(t)); } };
}
