export declare function digest(bytes: Uint8Array | string): string;
export declare class Refusal extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function refuse(code: string): never;
export interface Integrity {
    algorithm: string;
    hash: string;
    blockSize: number;
    blocks: string[];
}
export interface Entry {
    files?: Record<string, Entry>;
    size?: number;
    offset?: string;
    unpacked?: boolean;
    link?: string;
    integrity?: Integrity;
    [key: string]: unknown;
}
export interface ParsedArchive {
    header: Entry;
    headerBytes: Buffer;
    dataStart: number;
}
export declare function parseArchive(archive: Buffer): ParsedArchive;
export declare function entryAt(parsed: ParsedArchive, path: string): Entry;
export declare function entryBytes(archive: Buffer, parsed: ParsedArchive, entry: Entry): Buffer;
export declare function readEntry(archive: Buffer, path: string): Buffer;
export declare function rebuildArchive(original: Buffer, replacements: ReadonlyMap<string, Buffer>, additions: ReadonlyMap<string, Buffer>): Buffer;
export declare function verifyArchiveIntegrity(archive: Buffer): number;
