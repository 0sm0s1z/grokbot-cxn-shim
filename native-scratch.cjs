"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syntheticScratchSend = syntheticScratchSend;
exports.routedScratchSend = routedScratchSend;
exports.createLabScratchRouter = createLabScratchRouter;
function syntheticScratchSend(options, method, args) {
    if (!options.agentId || typeof options.sessionId !== 'string' || method !== 'sendPrompt' ||
        args.agentId !== options.agentId || (args.sessionId ?? '') !== options.sessionId)
        return undefined;
    if (typeof args.prompt !== 'string' || !args.prompt.trim() || !args.clientNonce || args.attachmentPaths?.length) {
        throw new Error('selected scratch turn must contain only text');
    }
    const timestampMs = options.now();
    const user = { id: args.clientNonce, kind: 'message', role: 'user', content: args.prompt,
        clientNonce: args.clientNonce, timestampMs };
    const assistant = { id: options.makeId(), kind: 'message', role: 'assistant',
        content: 'Synthetic local fixture response. No router request was made.', timestampMs };
    if (!options.emit([user, assistant]))
        throw new Error('scratch transcript unavailable');
    return { accepted: true };
}
/** One selected text-only turn; provider and native event sink are explicit dependencies. */
async function routedScratchSend(options, method, args, signal) {
    if (!options.agentId || method !== 'sendPrompt' || args.agentId !== options.agentId ||
        (args.sessionId ?? '') !== options.sessionId)
        return undefined;
    if (typeof args.prompt !== 'string' || !args.prompt.trim() || !args.clientNonce || args.attachmentPaths?.length)
        throw new Error('selected scratch turn must contain only text');
    signal.throwIfAborted();
    if (!options.ready())
        throw new Error('scratch transcript unavailable');
    const text = await options.complete(args.prompt, signal);
    signal.throwIfAborted();
    if (typeof text !== 'string' || !text.trim())
        throw new Error('provider returned no text');
    const timestampMs = options.now();
    if (!options.emit([
        { id: args.clientNonce, kind: 'message', role: 'user', content: args.prompt, clientNonce: args.clientNonce, timestampMs },
        { id: options.makeId(), kind: 'message', role: 'assistant', content: text, timestampMs },
    ]))
        throw new Error('scratch transcript unavailable');
    return { accepted: true };
}
/** Explicit per-turn commands in the lab select one conversation; normal sends delegate. */
function createLabScratchRouter(options) {
    const saved = options.store?.read();
    let selected = saved?.target;
    let history = saved?.turns.filter(t => !t.synthetic).flatMap(t => [
        { role: 'user', content: t.modelPrompt }, { role: 'assistant', content: t.answer }
    ]) ?? [];
    let busy = false;
    return async (method, args, signal) => {
        if (method !== 'sendPrompt' || typeof args.prompt !== 'string')
            return;
        const synthetic = args.prompt.startsWith('/shim-synthetic '), explicitRouter = args.prompt.startsWith('/shim-router ');
        const isSelected = selected !== undefined && args.agentId === selected.agentId && (args.sessionId ?? '') === selected.sessionId;
        if (!synthetic && !explicitRouter && !isSelected)
            return;
        if (busy)
            throw Error('scratch turn already in progress');
        busy = true;
        try {
            if (!args.agentId || !args.clientNonce || args.attachmentPaths?.length)
                throw Error('scratch requires a text-only conversation');
            if (options.store?.read()?.turns.some(t => t.nonce === args.clientNonce))
                throw Error('duplicate scratch turn');
            const target = { agentId: args.agentId, sessionId: args.sessionId ?? '' };
            if (!selected && !synthetic)
                throw Error('start this scratch session with /shim-synthetic');
            if (selected && (selected.agentId !== target.agentId || selected.sessionId !== target.sessionId))
                throw Error('another conversation owns the scratch session');
            const prompt = (synthetic ? args.prompt.slice(16) : explicitRouter ? args.prompt.slice(13) : args.prompt).trim();
            if (!prompt)
                throw Error('scratch prompt is empty');
            const sig = signal ?? new AbortController().signal;
            sig.throwIfAborted();
            if (!options.ready(target))
                throw Error('scratch transcript unavailable');
            const next = [...history, { role: 'user', content: prompt }];
            const text = synthetic ? 'Synthetic local fixture response. No router request was made.' : await options.complete(next, sig, target);
            sig.throwIfAborted();
            if (typeof text !== 'string' || !text.trim())
                throw Error('provider returned no text');
            const timestampMs = options.now();
            options.store?.append(target, { nonce: args.clientNonce, prompt: args.prompt, modelPrompt: prompt, answer: text, at: timestampMs, synthetic });
            selected = target;
            if (!synthetic)
                history = [...next, { role: 'assistant', content: text }];
            if (!options.emit(target, [{ id: `scratch-user-${args.clientNonce}`, kind: 'message', role: 'user', content: args.prompt, clientNonce: args.clientNonce, timestampMs },
                { id: `scratch-assistant-${args.clientNonce}`, kind: 'message', role: 'assistant', content: text, timestampMs }]))
                throw Error('scratch transcript unavailable');
            return { accepted: true };
        }
        finally {
            busy = false;
        }
    };
}
