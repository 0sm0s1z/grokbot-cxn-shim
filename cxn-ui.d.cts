type Model = {
    id: string;
    displayName: string;
    provider?: string;
};
export declare const alias: (id: string) => string;
export declare function modelChoices(models: readonly Model[]): {
    id: string;
    alias: string;
    name: string;
    label: string;
}[];
export declare function findModel(models: readonly Model[], query: string): {
    id: string;
    alias: string;
    name: string;
    label: string;
}[];
export declare function prettyWhen(t: number | null, now: number): string;
export declare function prettyDuration(ms: number): string;
export {};
