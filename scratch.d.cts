/** Offline contract for one explicitly selected, text-only scratch turn.
 * This module is not wired to Grok Bot's transcript or transport. */
export type ScratchMessage = {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
};
export interface ScratchTurn {
    readonly conversationId: string;
    readonly messages: readonly ScratchMessage[];
    readonly signal: AbortSignal;
}
export interface ScratchProvider {
    complete(request: {
        model: string;
        messages: readonly ScratchMessage[];
    }, signal: AbortSignal): Promise<string>;
}
export interface ScratchRenderer {
    /** Must persist/render the response in the native transcript; not implemented here. */
    complete(conversationId: string, text: string): Promise<void>;
}
export declare function createScratchAdapter(options: {
    conversationId: string;
    model: string;
    provider: ScratchProvider;
    renderer: ScratchRenderer;
}): (turn: ScratchTurn) => Promise<"not-selected" | "rendered">;
