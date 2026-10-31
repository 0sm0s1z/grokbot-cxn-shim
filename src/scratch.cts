/** Offline contract for one explicitly selected, text-only scratch turn.
 * This module is not wired to Grok Bot's transcript or transport. */
export type ScratchMessage = { readonly role: 'system' | 'user' | 'assistant'; readonly content: string };
export interface ScratchTurn {
  readonly conversationId: string;
  readonly messages: readonly ScratchMessage[];
  readonly signal: AbortSignal;
}
export interface ScratchProvider {
  complete(request: { model: string; messages: readonly ScratchMessage[] }, signal: AbortSignal): Promise<string>;
}
export interface ScratchRenderer {
  /** Must persist/render the response in the native transcript; not implemented here. */
  complete(conversationId: string, text: string): Promise<void>;
}
export function createScratchAdapter(options: { conversationId: string; model: string; provider: ScratchProvider; renderer: ScratchRenderer }) {
  if (!options.conversationId || !options.model) throw new TypeError('scratch conversation and model are required');
  return async function run(turn: ScratchTurn): Promise<'not-selected' | 'rendered'> {
    if (turn.conversationId !== options.conversationId) return 'not-selected';
    turn.signal.throwIfAborted();
    if (!Array.isArray(turn.messages) || !turn.messages.length || turn.messages.some(m =>
      !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
      throw new TypeError('scratch messages must be text-only');
    }
    const text = await options.provider.complete({ model: options.model, messages: turn.messages }, turn.signal);
    turn.signal.throwIfAborted();
    if (typeof text !== 'string' || !text.trim()) throw new Error('provider returned no text');
    await options.renderer.complete(turn.conversationId, text);
    return 'rendered';
  };
}
