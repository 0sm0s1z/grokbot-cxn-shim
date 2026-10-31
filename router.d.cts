/** Only the isolated, explicitly selected scratch route calls this function. */
export declare function completeScratch(messages: readonly {
    role: 'user' | 'assistant';
    content: string;
}[], signal: AbortSignal, model?: string, report?: (stats: {
    success: boolean;
    checkedAt: number;
    durationMs: number;
    usage?: Record<string, number>;
}) => void): Promise<string>;
