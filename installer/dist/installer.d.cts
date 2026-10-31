import { Refusal } from './asar.cts';
export interface Pins {
    appVersion: string;
    bundleVersion: string;
    bundleIdentifier: string;
    archiveSha256: string;
    archiveHeaderSha256: string;
    module: string;
    moduleSha256: string;
    moduleByteOffset: number;
    original: string;
    proposed: string;
    infoPlistSha256: string;
    frameworkSha256: string;
}
export declare const baseline: Pins;
export interface Options {
    app: string;
    shimPackage?: string;
    offlineCopy?: boolean;
    recoverPending?: boolean;
    /** Test injection is not exposed by the CLI. */
    testFaultAt?: 'after-asar' | 'after-plist' | 'after-state';
}
export declare function isLiveAppPath(app: string): boolean;
export declare function inspect(options: Options, pins?: Pins): Record<string, unknown>;
export declare function dryRun(options: Options, pins?: Pins): Record<string, unknown>;
export declare function install(options: Options, pins?: Pins): Record<string, unknown>;
export declare function restore(options: Options, pins?: Pins): Record<string, unknown>;
export { Refusal };
