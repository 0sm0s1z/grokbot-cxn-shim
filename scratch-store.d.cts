type Target = {
    agentId: string;
    sessionId: string;
};
type Turn = {
    nonce: string;
    prompt: string;
    modelPrompt: string;
    answer: string;
    at: number;
    synthetic: boolean;
};
type Data = {
    version: 1;
    target: Target;
    turns: Turn[];
};
export declare function createScratchStore(file: string): {
    read: () => Data | undefined;
    append(target: Target, turn: Turn): void;
    merge(target: Target, server: readonly Record<string, unknown>[]): Record<string, unknown>[];
};
export declare function getScratchStore(): {
    read: () => Data | undefined;
    append(target: Target, turn: Turn): void;
    merge(target: Target, server: readonly Record<string, unknown>[]): Record<string, unknown>[];
};
export {};
