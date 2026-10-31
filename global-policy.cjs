"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeLabel = routeLabel;
exports.snapshotFromNativeRead = snapshotFromNativeRead;
exports.keyOf = keyOf;
exports.evaluateTurn = evaluateTurn;
exports.createGlobalPolicy = createGlobalPolicy;
function routeLabel(decision) {
    if (decision.route === 'router')
        return 'Constellation: verified text-only turn';
    switch (decision.reason) {
        case 'unsupported-content': return 'Native: attachments or rich content';
        case 'unsupported-native-context': return 'Native: conversation contains unsupported context';
        case 'text-only-not-proven': return 'Native: tool requirements are not established';
        case 'native-continuation-not-proven': return 'Native: native continuation is not established';
        case 'native-model-context-not-proven': return 'Native: model instructions are not available';
        case 'complete-context-not-proven': return 'Native: complete conversation context is unavailable';
        default: return 'Native: turn is not eligible';
    }
}
/** `hasMore` and loss counters must come from the native read before its lossy page projection. */
function snapshotFromNativeRead(input) {
    const complete = Number.isSafeInteger(input.generation) && input.generation > 0 && typeof input.revision === 'string' && input.revision.length > 0 && input.hasMore === false &&
        input.unresolvedBodies === 0 && input.droppedRows === 0;
    return { target: input.target, generation: complete ? String(input.generation) : '', revision: input.revision, complete, rows: input.rows };
}
function keyOf(t) { return JSON.stringify([t.agentId, t.sessionId]); }
function evaluateTurn(req, proof, snapshot) {
    if (!req.target.agentId || !req.nonce || !req.text.trim())
        return { route: 'native', reason: 'invalid-text' };
    if (req.attachments?.length || req.richText !== undefined || req.replyToId !== undefined)
        return { route: 'native', reason: 'unsupported-content' };
    if (!proof?.textOnly)
        return { route: 'native', reason: 'text-only-not-proven' };
    if (!proof.nativeModelContextVerified || !Array.isArray(proof.nativeSystemMessages) ||
        proof.nativeSystemMessages.some(m => m?.role !== 'system' || typeof m.content !== 'string'))
        return { route: 'native', reason: 'native-model-context-not-proven' };
    if (!proof.canonicalContinuationVerified)
        return { route: 'native', reason: 'native-continuation-not-proven' };
    if (!snapshot || !snapshot.complete || !snapshot.generation || !snapshot.revision || keyOf(snapshot.target) !== keyOf(req.target))
        return { route: 'native', reason: 'complete-context-not-proven' };
    const seen = new Set(), allowed = new Set(['id', 'kind', 'role', 'content', 'timestampMs', 'clientNonce', 'seq']);
    let previous = -Infinity;
    for (const row of snapshot.rows) {
        if (!row.id || seen.has(row.id) || row.kind !== 'message' || (row.role !== 'user' && row.role !== 'assistant') ||
            Object.keys(row).some(key => !allowed.has(key)) || typeof row.content !== 'string' || typeof row.timestampMs !== 'number' || !Number.isFinite(row.timestampMs) || row.timestampMs < previous)
            return { route: 'native', reason: 'unsupported-native-context' };
        previous = row.timestampMs;
        seen.add(row.id);
    }
    return { route: 'router', reason: 'verified-text-only' };
}
/**
 * The caller must supply real, independently verified proofs and a canonical bridge.
 * Unselected calls return the native function's exact result. Once provider work starts,
 * failures never fall back to native, avoiding double processing.
 */
function createGlobalPolicy(options) {
    const operations = new Map(), busy = new Set();
    return function dispatch(req, proof, snapshot, native) {
        const chat = keyOf(req.target), operation = JSON.stringify([chat, req.nonce]);
        const prior = operations.get(operation);
        if (prior)
            return prior;
        let known;
        try {
            known = options.journal.lookup(req.target, req.nonce);
        }
        catch (e) {
            return Promise.reject(e);
        }
        if (known === 'started')
            return Promise.reject(new Error('prior routed turn has an uncertain outcome'));
        if (known === 'committed')
            return Promise.resolve({ accepted: true });
        if (known === 'native') {
            let owner;
            try {
                owner = options.journal.markNative(req.target, req.nonce);
            }
            catch (e) {
                return Promise.reject(e);
            }
            if (owner === 'busy')
                return Promise.reject(new Error('conversation has an active routed turn'));
            if (owner !== 'native')
                return Promise.reject(new Error('native ownership changed'));
            try {
                options.onRoute?.(req.target, { route: 'native', reason: 'already-native' });
            }
            catch { }
            return native();
        }
        if (known !== 'new')
            return Promise.reject(new Error('invalid journal lookup'));
        const decision = evaluateTurn(req, proof, snapshot);
        if (decision.route === 'native') {
            let owner;
            try {
                owner = options.journal.markNative(req.target, req.nonce);
            }
            catch (e) {
                return Promise.reject(e);
            }
            if (owner === 'native') {
                try {
                    options.onRoute?.(req.target, decision);
                }
                catch { }
                return native();
            }
            if (owner === 'committed')
                return Promise.resolve({ accepted: true });
            if (owner === 'busy')
                return Promise.reject(new Error('conversation has an active routed turn'));
            return Promise.reject(new Error('prior routed turn has an uncertain outcome'));
        }
        if (busy.has(chat))
            return Promise.reject(new Error('conversation has an active routed turn'));
        busy.add(chat);
        const work = (async () => {
            req.signal.throwIfAborted();
            const claim = options.journal.claim(req.target, req.nonce);
            if (claim === 'committed')
                return { accepted: true };
            if (claim === 'started')
                throw new Error('prior routed turn has an uncertain outcome');
            if (claim === 'busy')
                throw new Error('conversation has an active routed turn');
            if (claim === 'native')
                throw new Error('turn is already owned by native dispatch');
            if (claim !== 'new')
                throw new Error('invalid journal claim');
            try {
                options.onRoute?.(req.target, decision);
            }
            catch { }
            let committed = false;
            try {
                const messages = [...proof.nativeSystemMessages, ...snapshot.rows.filter(r => r.role !== 'user' || r.clientNonce !== req.nonce).map(r => ({ role: r.role, content: r.content }))];
                messages.push({ role: 'user', content: req.text });
                const answer = await options.complete(messages, req.signal);
                req.signal.throwIfAborted();
                if (typeof answer !== 'string' || !answer.trim())
                    throw new Error('provider returned no text');
                await options.bridge.commit(req.target, req.nonce, req.text, answer, { generation: snapshot.generation, revision: snapshot.revision }, req.signal);
                committed = true;
                return { accepted: true };
            }
            finally {
                options.journal.finish(req.target, req.nonce, committed ? 'committed' : 'uncertain');
            }
        })();
        operations.set(operation, work);
        work.finally(() => busy.delete(chat)).catch(() => { });
        return work;
    };
}
