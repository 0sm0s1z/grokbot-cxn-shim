export type Metadata = Record<string, any>;
export declare function decodePlist(bytes: Buffer): Metadata;
export declare function encodePlist(metadata: Metadata, original: Buffer): Buffer;
