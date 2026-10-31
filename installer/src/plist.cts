import { execFileSync } from 'node:child_process';
import { refuse } from './asar.cts';
export type Metadata = Record<string, any>;

export function decodePlist(bytes: Buffer): Metadata {
  try {
    return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'],
      { input: bytes, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }).toString('utf8'));
  } catch { refuse('plist-decode-failed'); }
}
export function encodePlist(metadata: Metadata, original: Buffer): Buffer {
  try {
    return execFileSync('/usr/bin/plutil', ['-convert', original.subarray(0, 8).toString() === 'bplist00' ? 'binary1' : 'xml1',
      '-o', '-', '--', '-'], { input: Buffer.from(JSON.stringify(metadata)), timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  } catch { refuse('plist-encode-failed'); }
}
