import { createHash } from 'node:crypto';

export function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export class Refusal extends Error {
  constructor(public readonly code: string) { super(code); }
}
export function refuse(code: string): never { throw new Refusal(code); }
export interface Integrity { algorithm: string; hash: string; blockSize: number; blocks: string[] }
export interface Entry {
  files?: Record<string, Entry>; size?: number; offset?: string; unpacked?: boolean;
  link?: string; integrity?: Integrity; [key: string]: unknown;
}
export interface ParsedArchive { header: Entry; headerBytes: Buffer; dataStart: number }

export function parseArchive(archive: Buffer): ParsedArchive {
  if (archive.length < 16 || archive.readUInt32LE(0) !== 4) refuse('invalid-asar-header');
  const size = archive.readUInt32LE(4), jsonSize = archive.readUInt32LE(12);
  if (jsonSize < 2 || jsonSize > 16 * 1024 * 1024 || 16 + jsonSize > 8 + size || 8 + size > archive.length) {
    refuse('invalid-asar-bounds');
  }
  const headerBytes = archive.subarray(16, 16 + jsonSize);
  let header: Entry;
  try { header = JSON.parse(headerBytes.toString('utf8')); } catch { refuse('invalid-asar-json'); }
  if (!header.files || typeof header.files !== 'object') refuse('invalid-asar-tree');
  return { header, headerBytes, dataStart: 8 + size };
}
export function entryAt(parsed: ParsedArchive, path: string): Entry {
  let entry = parsed.header;
  for (const part of path.split('/')) {
    if (!Object.hasOwn(entry.files ?? {}, part)) refuse('asar-entry-missing');
    entry = entry.files![part];
  }
  return entry;
}
export function entryBytes(archive: Buffer, parsed: ParsedArchive, entry: Entry): Buffer {
  if (entry.files || entry.link || entry.unpacked || !/^\d+$/.test(String(entry.offset))
    || !Number.isSafeInteger(entry.size) || entry.size! < 0) refuse('unsupported-asar-entry');
  const offset = Number(entry.offset), start = parsed.dataStart + offset;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(start)
    || start + entry.size! > archive.length) refuse('asar-entry-out-of-bounds');
  return archive.subarray(start, start + entry.size!);
}
export function readEntry(archive: Buffer, path: string): Buffer {
  const parsed = parseArchive(archive);
  return entryBytes(archive, parsed, entryAt(parsed, path));
}
function entries(header: Entry): Array<{ path: string; entry: Entry }> {
  const result: Array<{ path: string; entry: Entry }> = [];
  function walk(node: Entry, prefix: string): void {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      if (entry.files) walk(entry, prefix + name + '/');
      else result.push({ path: prefix + name, entry });
    }
  }
  walk(header, '');
  return result;
}
function integrity(bytes: Buffer, blockSize = 4194304): Integrity {
  if (!Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 64 * 1024 * 1024) refuse('unsupported-integrity-block-size');
  const blocks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) blocks.push(digest(bytes.subarray(offset, offset + blockSize)));
  return { algorithm: 'SHA256', hash: digest(bytes), blockSize, blocks };
}
export function rebuildArchive(original: Buffer, replacements: ReadonlyMap<string, Buffer>, additions: ReadonlyMap<string, Buffer>): Buffer {
  const parsed = parseArchive(original);
  const packed = entries(parsed.header).filter(({ entry }) => !entry.unpacked && !entry.link)
    .sort((a, b) => Number(a.entry.offset) - Number(b.entry.offset));
  const bodies: Buffer[] = [];
  const found = new Set<string>();
  let offset = 0;
  for (const { path, entry } of packed) {
    const oldBytes = entryBytes(original, parsed, entry);
    const changed = replacements.get(path);
    const bytes = changed ?? oldBytes;
    if (changed !== undefined) {
      found.add(path);
      entry.integrity = integrity(bytes, entry.integrity?.blockSize);
    }
    entry.offset = String(offset); entry.size = bytes.length;
    offset += bytes.length; bodies.push(bytes);
  }
  if ([...replacements.keys()].some((path) => !found.has(path))) refuse('replacement-entry-missing');
  for (const [path, bytes] of additions) {
    const parts = path.split('/');
    if (parts.some((part) => !/^[\w.@-]+$/.test(part) || part === '..')) refuse('invalid-addition-path');
    let parent = parsed.header;
    for (const part of parts.slice(0, -1)) {
      parent.files ??= {};
      if (!Object.hasOwn(parent.files, part)) parent.files[part] = { files: {} };
      parent = parent.files[part];
      if (!parent.files) refuse('addition-parent-conflict');
    }
    const name = parts.at(-1)!;
    if (Object.hasOwn(parent.files!, name)) refuse('addition-entry-conflict');
    parent.files![name] = { size: bytes.length, offset: String(offset), integrity: integrity(bytes) };
    offset += bytes.length; bodies.push(bytes);
  }
  const json = Buffer.from(JSON.stringify(parsed.header));
  const payloadSize = Math.ceil((4 + json.length) / 4) * 4;
  const headerPickle = Buffer.alloc(4 + payloadSize);
  headerPickle.writeUInt32LE(payloadSize, 0); headerPickle.writeUInt32LE(json.length, 4); json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0); sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, ...bodies]);
}
export function verifyArchiveIntegrity(archive: Buffer): number {
  const parsed = parseArchive(archive);
  let count = 0;
  for (const { entry } of entries(parsed.header)) {
    if (entry.unpacked || entry.link) continue;
    const bytes = entryBytes(archive, parsed, entry);
    if (!entry.integrity || entry.integrity.algorithm !== 'SHA256') refuse('missing-or-unsupported-asar-integrity');
    if (digest(bytes) !== entry.integrity.hash) refuse('asar-file-integrity-mismatch');
    const actual = integrity(bytes, entry.integrity.blockSize);
    if (JSON.stringify(actual.blocks) !== JSON.stringify(entry.integrity.blocks)) refuse('asar-block-integrity-mismatch');
    count += 1;
  }
  return count;
}
