import { createCatalog } from './cxn-catalog.cjs';
type Target = {
    agentId: string;
    sessionId: string;
};
type Row = Record<string, unknown>;
type Saved = {
    legacyMigrated?: boolean;
    mode: 'native' | 'router';
    rows: Row[];
    operations: Record<string, 'started' | 'complete' | 'failed' | 'native'>;
    model?: string;
    recent?: {
        success: boolean;
        checkedAt: number;
        durationMs: number;
        usage?: Record<string, number>;
    };
};
/** Local plaintext journal. A started operation is never retried automatically. */
export declare function createExplicitJournal(file: string): {
    getGlobalMode(): "selective";
    setGlobalMode(): void;
    get(t: Target): Saved;
    update(t: Target, fn: (c: Saved) => void): void;
    merge(t: Target, rows: readonly Row[]): Row[];
};
/** Accept formatting metadata only when it is provably the same plain text. */
export declare function isPlainRichText(value: unknown, prompt: string): boolean;
export declare function createExplicitChat(options: {
    journal: ReturnType<typeof createExplicitJournal>;
    ready: (t: Target) => boolean;
    emit: (t: Target, r: readonly Row[]) => boolean;
    update?: (t: Target, r: Row) => boolean;
    complete: (m: readonly {
        role: 'user' | 'assistant';
        content: string;
    }[], s: AbortSignal, t?: Target) => Promise<string>;
    now: () => number;
    catalog?: ReturnType<typeof createCatalog>;
    scratchTarget?: (t: Target) => boolean;
}): {
    capture: (t: Target, rows: Row[], complete: boolean) => void;
    send: (method: string, args: {
        agentId?: string;
        sessionId?: string;
        prompt?: string;
        clientNonce?: string;
        attachmentPaths?: readonly string[];
        richText?: unknown;
        replyToId?: unknown;
        replySessionId?: unknown;
        replyQuote?: unknown;
        fileReference?: unknown;
    }, signal?: AbortSignal) => Promise<{
        accepted: true;
    } | undefined>;
    command: (method: string, args: {
        agentId?: string;
        sessionId?: string;
        prompt?: string;
        clientNonce?: string;
    }) => Promise<{
        accepted: true;
    } | undefined>;
    migrateLegacy: (t: Target) => void;
    invalidate(t: Target): void;
};
export {};
