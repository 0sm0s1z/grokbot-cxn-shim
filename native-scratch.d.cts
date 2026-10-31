/** Lab-only, in-memory transcript event helper. It is not installed in the app. */
export interface NativeScratchOptions {
    readonly agentId: string;
    readonly sessionId: string;
    readonly emit: (entries: readonly Record<string, unknown>[]) => boolean;
    readonly makeId: () => string;
    readonly now: () => number;
}
export declare function syntheticScratchSend(options: NativeScratchOptions, method: string, args: {
    agentId?: string;
    sessionId?: string;
    prompt?: string;
    clientNonce?: string;
    attachmentPaths?: readonly string[];
}): {
    accepted: true;
} | undefined;
/** One selected text-only turn; provider and native event sink are explicit dependencies. */
export declare function routedScratchSend(options: NativeScratchOptions & {
    readonly ready: () => boolean;
    readonly complete: (prompt: string, signal: AbortSignal) => Promise<string>;
}, method: string, args: {
    agentId?: string;
    sessionId?: string;
    prompt?: string;
    clientNonce?: string;
    attachmentPaths?: readonly string[];
}, signal: AbortSignal): Promise<{
    accepted: true;
} | undefined>;
/** Explicit per-turn commands in the lab select one conversation; normal sends delegate. */
export declare function createLabScratchRouter(options: {
    readonly ready: (args: {
        agentId: string;
        sessionId: string;
    }) => boolean;
    readonly emit: (args: {
        agentId: string;
        sessionId: string;
    }, entries: readonly Record<string, unknown>[]) => boolean;
    readonly complete: (messages: readonly {
        role: 'user' | 'assistant';
        content: string;
    }[], signal: AbortSignal, target?: {
        agentId: string;
        sessionId: string;
    }) => Promise<string>;
    readonly makeId: () => string;
    readonly now: () => number;
    readonly legacyCommandsOnly?: boolean;
    readonly store?: {
        read: () => {
            target: {
                agentId: string;
                sessionId: string;
            };
            turns: {
                nonce: string;
                modelPrompt: string;
                answer: string;
                synthetic: boolean;
            }[];
        } | undefined;
        append: (target: {
            agentId: string;
            sessionId: string;
        }, turn: {
            nonce: string;
            prompt: string;
            modelPrompt: string;
            answer: string;
            at: number;
            synthetic: boolean;
        }) => void;
    };
}): (method: string, args: {
    agentId?: string;
    sessionId?: string;
    prompt?: string;
    clientNonce?: string;
    attachmentPaths?: readonly string[];
    richText?: string;
}, signal?: AbortSignal) => Promise<{
    accepted: true;
} | undefined>;
