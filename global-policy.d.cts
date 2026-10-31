/** Policy and orchestration contracts only. No live Grok Bot hook supplies these proofs yet. */
export type Target = Readonly<{
    agentId: string;
    sessionId: string;
}>;
export type TextMessage = Readonly<{
    role: 'system' | 'user' | 'assistant';
    content: string;
}>;
export type NativeRow = Readonly<{
    id: string;
    kind: string;
    role?: string;
    content?: unknown;
    timestampMs?: number;
    clientNonce?: string;
}>;
export type NativeSnapshot = Readonly<{
    target: Target;
    complete: boolean;
    generation: string;
    revision: string;
    rows: readonly NativeRow[];
}>;
export type Proof = Readonly<{
    textOnly: boolean;
    /** System instructions and other native model context are available and equivalent. */
    nativeModelContextVerified: boolean;
    nativeSystemMessages: readonly Readonly<{
        role: 'system';
        content: string;
    }>[];
    /** True only when an integration has proved exact-once canonical persistence and native continuation. */
    canonicalContinuationVerified: boolean;
}>;
export type Request = Readonly<{
    target: Target;
    nonce: string;
    text: string;
    attachments?: readonly unknown[];
    richText?: string;
    replyToId?: string;
    signal: AbortSignal;
}>;
export type Decision = Readonly<{
    route: 'native' | 'router';
    reason: string;
}>;
export declare function routeLabel(decision: Decision): string;
/** `hasMore` and loss counters must come from the native read before its lossy page projection. */
export declare function snapshotFromNativeRead(input: {
    target: Target;
    generation: number;
    revision: string;
    hasMore: boolean;
    unresolvedBodies: number;
    droppedRows: number;
    rows: readonly NativeRow[];
}): NativeSnapshot;
export interface Bridge {
    /** Atomic, idempotent canonical commit; must include the original user turn and assistant answer. */
    commit(target: Target, nonce: string, userText: string, answer: string, expected: {
        generation: string;
        revision: string;
    }, signal: AbortSignal): Promise<void>;
}
/** Must durably reserve a nonce and serialize work per conversation, even across restarts. */
export interface Journal {
    lookup(target: Target, nonce: string): 'new' | 'native' | 'started' | 'committed';
    /** Atomically records native ownership against any concurrent router claim. */
    markNative(target: Target, nonce: string): 'native' | 'started' | 'committed' | 'busy';
    claim(target: Target, nonce: string): 'new' | 'native' | 'started' | 'committed' | 'busy';
    finish(target: Target, nonce: string, outcome: 'committed' | 'uncertain'): void;
}
export declare function keyOf(t: Target): string;
export declare function evaluateTurn(req: Request, proof: Proof | undefined, snapshot: NativeSnapshot | undefined): Decision;
/**
 * The caller must supply real, independently verified proofs and a canonical bridge.
 * Unselected calls return the native function's exact result. Once provider work starts,
 * failures never fall back to native, avoiding double processing.
 */
export declare function createGlobalPolicy<T>(options: {
    readonly bridge: Bridge;
    readonly journal: Journal;
    readonly complete: (messages: readonly TextMessage[], signal: AbortSignal) => Promise<string>;
    readonly onRoute?: (target: Target, decision: Decision) => void;
}): (req: Request, proof: Proof | undefined, snapshot: NativeSnapshot | undefined, native: () => T) => T | Promise<T>;
