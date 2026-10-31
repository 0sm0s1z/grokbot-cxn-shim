export type Operation = 'unary' | 'stream';
export interface MethodSelector {
    readonly operation: Operation;
    readonly service: string;
    readonly method: string;
    readonly inputType?: string;
    readonly outputType?: string;
}
export interface InspectionLimits {
    readonly maxNodes?: number;
    readonly maxDepth?: number;
    readonly maxProperties?: number;
}
export interface CallMetadata {
    readonly operation: Operation;
    readonly service: string;
    readonly method: string;
    readonly methodKind?: number;
    readonly inputType?: string;
    readonly outputType?: string;
    readonly signalPresent: boolean;
    readonly signalAborted: boolean;
    readonly timeoutMs?: number;
    readonly callerHeadersPresent: boolean;
    readonly contextValuesPresent: boolean;
}
export interface StructureSummary {
    readonly rootKind: string;
    readonly nodesVisited: number;
    readonly counts: Readonly<Record<'null' | 'undefined' | 'boolean' | 'number' | 'bigint' | 'string' | 'symbol' | 'function' | 'object' | 'array' | 'binary' | 'opaque', number>>;
    readonly ownPropertySlotsVisited: number;
    readonly accessorPropertiesSkipped: number;
    readonly symbolPropertiesSkipped: number;
    readonly unreadablePropertiesSkipped: number;
    readonly repeatedObjectsSkipped: number;
    readonly opaqueObjectsSkipped: number;
    readonly binaryBytesObserved: number;
    readonly arraySlotsVisited: number;
    readonly truncated: boolean;
}
export interface InspectionEvent {
    readonly phase: 'request';
    readonly metadata: CallMetadata;
    readonly messageIndex: number;
    readonly structure: StructureSummary;
}
export interface Diagnostic {
    readonly phase: 'policy' | 'observer';
    readonly code: 'async-policy-unsupported' | 'policy-failed' | 'observer-rejected' | 'observer-failed';
}
export interface ShimOptions {
    readonly knownMethods?: readonly MethodSelector[];
    /** Synchronous metadata-only decision. No routing action exists in this package. */
    readonly policy?: (metadata: CallMetadata) => 'delegate' | 'inspect-structure';
    readonly onInspect?: (event: InspectionEvent) => void | PromiseLike<void>;
    readonly onDiagnostic?: (diagnostic: Diagnostic) => void | PromiseLike<void>;
    readonly inspection?: InspectionLimits;
    readonly maxStreamMessages?: number;
}
export interface TransportLike {
    unary: (...args: any[]) => any;
    stream: (...args: any[]) => any;
}
/** Summarize own data values without recording keys, scalar values, or message references. */
export declare function inspectMessageStructure(value: unknown, options?: InspectionLimits): StructureSummary;
/** Wrap Connect 1.x Transport.unary/stream. This proof only delegates; it has no routing action. */
export declare function wrapConnectTransport<T extends TransportLike>(nativeTransport: T, options?: ShimOptions): Pick<T, 'unary' | 'stream'>;
