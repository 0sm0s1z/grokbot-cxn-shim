export declare const ORIGIN: string;
type Model = {
    id: string;
    displayName: string;
    provider?: string;
};
type Cache = {
    version: 1;
    models: Model[];
    syncedAt: number | null;
    checkedAt: number | null;
    availability: 'unknown' | 'available' | 'unavailable';
    error: string | null;
};
export declare function keyFromFile(): string;
export declare function discoverModels(): Promise<unknown>;
export declare function createCatalog(file: string, discover?: () => Promise<unknown>, now?: () => number): {
    read: () => Cache;
    refresh: () => Promise<Cache>;
    isStale: (d: Cache) => boolean;
};
export {};
