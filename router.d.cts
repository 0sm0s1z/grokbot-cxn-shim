export declare function classifyRouterError(e: unknown, signal: AbortSignal): string;
/** Router completions contain only the supplied conversation context. */
export declare function completeScratch(messages: readonly {
    role: 'user' | 'assistant';
    content: string;
}[], signal: AbortSignal, model?: string, report?: (stats: {
    success: boolean;
    checkedAt: number;
    durationMs: number;
    failure?: string;
    usage?: Record<string, number>;
}) => void): Promise<string>;
