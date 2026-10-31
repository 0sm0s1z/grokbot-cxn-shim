"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScratchAdapter = createScratchAdapter;
function createScratchAdapter(options) {
    if (!options.conversationId || !options.model)
        throw new TypeError('scratch conversation and model are required');
    return async function run(turn) {
        if (turn.conversationId !== options.conversationId)
            return 'not-selected';
        turn.signal.throwIfAborted();
        if (!Array.isArray(turn.messages) || !turn.messages.length || turn.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
            throw new TypeError('scratch messages must be text-only');
        }
        const text = await options.provider.complete({ model: options.model, messages: turn.messages }, turn.signal);
        turn.signal.throwIfAborted();
        if (typeof text !== 'string' || !text.trim())
            throw new Error('provider returned no text');
        await options.renderer.complete(turn.conversationId, text);
        return 'rendered';
    };
}
