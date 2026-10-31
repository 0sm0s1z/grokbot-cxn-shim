import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, parseArchive, readEntry, rebuildArchive, verifyArchiveIntegrity, refuse, Refusal } from './asar.cts';
import { decodePlist, encodePlist, type Metadata } from './plist.cts';

export interface Pins {
  appVersion: string; bundleVersion: string; bundleIdentifier: string;
  archiveSha256: string; archiveHeaderSha256: string; module: string;
  moduleSha256: string; moduleByteOffset: number; original: string; proposed: string;
  infoPlistSha256: string; frameworkSha256: string;
}
export const baseline: Pins = require('../baseline.json');
const OWNER = 'grokbot-connect-shim-installer';
const RUNTIME = 'dist/electron-main/grokbot-connect-shim/index.cjs';
const RUNTIME_PACKAGE = 'dist/electron-main/grokbot-connect-shim/package.json';
const STATE_VERSION = 1;
export interface Options {
  app: string; shimPackage?: string; offlineCopy?: boolean; recoverPending?: boolean;
  /** Test injection is not exposed by the CLI. */
  testFaultAt?: 'after-asar' | 'after-plist' | 'after-state';
}
interface Paths { app: string; asar: string; plist: string; backup: string; state: string; journal: string; lock: string }
interface State {
  format: 1; owner: string; target: string; status: 'restored' | 'installed';
  originalArchiveSha256: string; originalPlistSha256: string;
  archiveSha256: string; plistSha256: string; moduleSha256: string;
  shimSha256?: string; shimVersion?: string;
}
interface Loaded { paths: Paths; archive: Buffer; plist: Buffer; metadata: Metadata; state?: State }
interface Plan { loaded: Loaded; archive: Buffer; plist: Buffer; finalState: State; operation: 'install' | 'update' | 'unchanged'; packedFilesVerified: number }
interface Journal { format: 1; owner: string; target: string; beforeArchive: string; beforePlist: string; beforeState: string; afterArchive: string; afterPlist: string }

function jsonBytes(value: unknown): Buffer { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function regularFile(name: string): void {
  const stat = fs.lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse('target-file-not-regular');
}
function pathsOf(app: string): Paths {
  const resolved = fs.realpathSync(app);
  if (!fs.statSync(resolved).isDirectory()) refuse('app-target-not-directory');
  const asar = path.join(resolved, 'Contents/Resources/app.asar');
  const plist = path.join(resolved, 'Contents/Info.plist');
  for (const target of [asar, plist]) {
    regularFile(target);
    if (!fs.realpathSync(target).startsWith(resolved + path.sep)) refuse('target-file-outside-app');
  }
  const backup = resolved + '.grokbot-shim-backup';
  if (fs.existsSync(backup) && (fs.lstatSync(backup).isSymbolicLink() || !fs.statSync(backup).isDirectory())) refuse('backup-path-conflict');
  return { app: resolved, asar, plist, backup, state: path.join(backup, 'state.json'),
    journal: path.join(backup, 'transaction.json'), lock: resolved + '.grokbot-shim-lock' };
}
export function isLiveAppPath(app: string): boolean {
  return /^\/(?:System\/)?Applications(?:\/|$)/i.test(app)
    || /^\/Users\/[^/]+\/Applications(?:\/|$)/i.test(app);
}
function assertOffline(paths: Paths, options: Options): void {
  if (!options.offlineCopy) refuse('mutation-requires-offline-copy');
  if (isLiveAppPath(paths.app)) refuse('live-app-mutation-refused');
}
function parseJson<T>(name: string, code: string): T {
  regularFile(name);
  try { return JSON.parse(fs.readFileSync(name, 'utf8')) as T; } catch { refuse(code); }
}
function stateOf(paths: Paths, pins: Pins): State | undefined {
  if (!fs.existsSync(paths.state)) {
    if (fs.existsSync(paths.backup)) refuse('incomplete-backup-refused');
    return undefined;
  }
  const state = parseJson<State>(paths.state, 'invalid-backup-state');
  if (state.format !== STATE_VERSION || state.owner !== OWNER || state.target !== paths.app
    || !['installed', 'restored'].includes(state.status)
    || state.originalArchiveSha256 !== pins.archiveSha256 || state.originalPlistSha256 !== pins.infoPlistSha256
    || ![state.archiveSha256, state.plistSha256, state.moduleSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))) {
    refuse('backup-state-conflict');
  }
  return state;
}
function checkIdentity(metadata: Metadata, pins: Pins): void {
  if (metadata.CFBundleShortVersionString !== pins.appVersion || metadata.CFBundleVersion !== pins.bundleVersion
    || metadata.CFBundleIdentifier !== pins.bundleIdentifier) refuse('app-version-or-identity-conflict');
}
function checkHeader(archive: Buffer, metadata: Metadata): void {
  const hash = digest(parseArchive(archive).headerBytes);
  const recorded = metadata.ElectronAsarIntegrity?.['Resources/app.asar'];
  if (recorded?.algorithm !== 'SHA256' || recorded.hash !== hash) refuse('plist-asar-integrity-conflict');
}
function proposedMain(original: Buffer, pins: Pins): Buffer {
  if (digest(original) !== pins.moduleSha256) refuse('original-main-hash-conflict');
  const needle = Buffer.from(pins.original);
  const at = original.indexOf(needle);
  if (at !== pins.moduleByteOffset || original.indexOf(needle, at + 1) !== -1) refuse('source-anchor-conflict');
  return Buffer.concat([original.subarray(0, at), Buffer.from(pins.proposed), original.subarray(at + needle.length)]);
}
function checkOriginal(archive: Buffer, plist: Buffer, pins: Pins): void {
  if (digest(archive) !== pins.archiveSha256 || digest(plist) !== pins.infoPlistSha256) refuse('unsupported-original-artifact');
  const metadata = decodePlist(plist);
  checkIdentity(metadata, pins); checkHeader(archive, metadata);
  if (digest(parseArchive(archive).headerBytes) !== pins.archiveHeaderSha256) refuse('original-header-hash-conflict');
  proposedMain(readEntry(archive, pins.module), pins);
}
function originalBackups(paths: Paths, pins: Pins): { archive: Buffer; plist: Buffer } {
  const archivePath = path.join(paths.backup, 'original.asar');
  const plistPath = path.join(paths.backup, 'original.Info.plist');
  regularFile(archivePath); regularFile(plistPath);
  const archive = fs.readFileSync(archivePath), plist = fs.readFileSync(plistPath);
  checkOriginal(archive, plist, pins);
  return { archive, plist };
}
function load(options: Options, pins: Pins, allowPending = false): Loaded {
  const paths = pathsOf(options.app);
  if (fs.existsSync(paths.journal) && !allowPending) refuse('interrupted-transaction-requires-restore');
  const state = stateOf(paths, pins);
  const archive = fs.readFileSync(paths.asar), plist = fs.readFileSync(paths.plist), metadata = decodePlist(plist);
  checkIdentity(metadata, pins);
  if (!allowPending) {
    checkHeader(archive, metadata);
    if (state?.status === 'installed') {
      const originals = originalBackups(paths, pins);
      if (digest(archive) !== state.archiveSha256 || digest(plist) !== state.plistSha256
        || digest(readEntry(archive, pins.module)) !== state.moduleSha256
        || digest(readEntry(archive, RUNTIME)) !== state.shimSha256) refuse('installed-artifact-conflict');
      const originalMain = readEntry(originals.archive, pins.module);
      if (digest(proposedMain(originalMain, pins)) !== state.moduleSha256) refuse('installed-source-anchor-conflict');
    } else {
      checkOriginal(archive, plist, pins);
      if (state) originalBackups(paths, pins);
    }
  }
  return { paths, archive, plist, metadata, state };
}
function originalState(paths: Paths, pins: Pins): State {
  return { format: 1, owner: OWNER, target: paths.app, status: 'restored',
    originalArchiveSha256: pins.archiveSha256, originalPlistSha256: pins.infoPlistSha256,
    archiveSha256: pins.archiveSha256, plistSha256: pins.infoPlistSha256, moduleSha256: pins.moduleSha256 };
}
function fsyncDirectory(name: string): void {
  const descriptor = fs.openSync(name, 'r');
  try { fs.fsyncSync(descriptor); } catch (error) {
    if (!['EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  } finally { fs.closeSync(descriptor); }
}
function stageFile(target: string, bytes: Buffer, mode: number): string {
  const temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.grokbot-' + randomUUID());
  const descriptor = fs.openSync(temporary, 'wx', mode & 0o777);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  finally { fs.closeSync(descriptor); }
  return temporary;
}
function atomicWrite(target: string, bytes: Buffer, mode = 0o600): void {
  const temporary = stageFile(target, bytes, mode);
  try { fs.renameSync(temporary, target); fsyncDirectory(path.dirname(target)); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function ensureBackup(loaded: Loaded, pins: Pins): State {
  if (loaded.state) return loaded.state;
  fs.mkdirSync(loaded.paths.backup, { mode: 0o700 });
  try {
    atomicWrite(path.join(loaded.paths.backup, 'original.asar'), loaded.archive);
    atomicWrite(path.join(loaded.paths.backup, 'original.Info.plist'), loaded.plist);
    const state = originalState(loaded.paths, pins);
    atomicWrite(loaded.paths.state, jsonBytes(state));
    return state;
  } catch (error) { fs.rmSync(loaded.paths.backup, { recursive: true, force: true }); throw error; }
}
function removeTransactionFiles(paths: Paths): void {
  for (const name of ['transaction.json', 'before.asar', 'before.Info.plist', 'before.state.json']) {
    fs.rmSync(path.join(paths.backup, name), { force: true });
  }
  fsyncDirectory(paths.backup);
}
function transaction(loaded: Loaded, archive: Buffer, plist: Buffer, state: State, options: Options): void {
  const { paths } = loaded;
  const beforeState = fs.readFileSync(paths.state);
  atomicWrite(path.join(paths.backup, 'before.asar'), loaded.archive);
  atomicWrite(path.join(paths.backup, 'before.Info.plist'), loaded.plist);
  atomicWrite(path.join(paths.backup, 'before.state.json'), beforeState);
  const journal: Journal = { format: 1, owner: OWNER, target: paths.app,
    beforeArchive: digest(loaded.archive), beforePlist: digest(loaded.plist), beforeState: digest(beforeState),
    afterArchive: digest(archive), afterPlist: digest(plist) };
  const asarMode = fs.statSync(paths.asar).mode, plistMode = fs.statSync(paths.plist).mode;
  const stagedAsar = stageFile(paths.asar, archive, asarMode);
  let stagedPlist: string | undefined;
  let started = false;
  try {
    stagedPlist = stageFile(paths.plist, plist, plistMode);
    // Refuse a concurrent artifact change, even if it did not use this installer's lock.
    if (digest(fs.readFileSync(paths.asar)) !== journal.beforeArchive
      || digest(fs.readFileSync(paths.plist)) !== journal.beforePlist) refuse('artifact-changed-during-staging');
    atomicWrite(paths.journal, jsonBytes(journal)); started = true;
    fs.renameSync(stagedAsar, paths.asar); fsyncDirectory(path.dirname(paths.asar));
    if (options.testFaultAt === 'after-asar') refuse('injected-transaction-failure');
    fs.renameSync(stagedPlist, paths.plist); fsyncDirectory(path.dirname(paths.plist));
    if (options.testFaultAt === 'after-plist') refuse('injected-transaction-failure');
    atomicWrite(paths.state, jsonBytes(state));
    if (options.testFaultAt === 'after-state') refuse('injected-transaction-failure');
    if (digest(fs.readFileSync(paths.asar)) !== journal.afterArchive
      || digest(fs.readFileSync(paths.plist)) !== journal.afterPlist) refuse('committed-file-hash-mismatch');
    removeTransactionFiles(paths);
  } catch (error) {
    if (started) {
      try {
        atomicWrite(paths.asar, loaded.archive, asarMode);
        atomicWrite(paths.plist, loaded.plist, plistMode);
        atomicWrite(paths.state, beforeState);
        removeTransactionFiles(paths);
      } catch { refuse('rollback-incomplete-restore-required'); }
    } else removeTransactionFiles(paths);
    throw error;
  } finally {
    fs.rmSync(stagedAsar, { force: true });
    if (stagedPlist) fs.rmSync(stagedPlist, { force: true });
  }
}
function withLock<T>(paths: Paths, recoverPending: boolean, run: () => T): T {
  if (fs.existsSync(paths.lock) && recoverPending) {
    if (fs.lstatSync(paths.lock).isSymbolicLink()) refuse('lock-path-conflict');
    const owner = parseJson<{ owner: string; target: string }>(path.join(paths.lock, 'owner.json'), 'invalid-lock-owner');
    if (owner.owner !== OWNER || owner.target !== paths.app) refuse('lock-owner-conflict');
    fs.rmSync(paths.lock, { recursive: true });
  }
  try { fs.mkdirSync(paths.lock, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') refuse('installer-lock-present'); throw error; }
  try { atomicWrite(path.join(paths.lock, 'owner.json'), jsonBytes({ owner: OWNER, target: paths.app })); return run(); }
  finally { fs.rmSync(paths.lock, { recursive: true, force: true }); }
}
function runtimePackage(root: string | undefined): { code: Buffer; metadata: Buffer; version: string } {
  if (!root) refuse('shim-package-path-required');
  const manifest = parseJson<{ name: string; version: string; main: string; dependencies?: object }>(path.join(root, 'package.json'), 'invalid-shim-package');
  if (manifest.name !== '@local/grokbot-connect-shim' || manifest.main !== 'index.cjs'
    || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)
    || Object.keys(manifest.dependencies ?? {}).length !== 0) refuse('unsupported-shim-package');
  const runtime = path.join(root, 'index.cjs'); regularFile(runtime);
  const code = fs.readFileSync(runtime);
  if (code.length < 1 || code.length > 1024 * 1024) refuse('unsupported-shim-runtime-size');
  return { code, version: manifest.version, metadata: jsonBytes({ name: manifest.name, version: manifest.version, private: true, main: 'index.cjs' }) };
}
function planInstall(options: Options, pins: Pins): Plan {
  const loaded = load(options, pins);
  const shim = runtimePackage(options.shimPackage);
  if (loaded.state?.status === 'installed' && loaded.state.shimSha256 === digest(shim.code)
    && loaded.state.shimVersion === shim.version) {
    return { loaded, archive: loaded.archive, plist: loaded.plist, finalState: loaded.state,
      operation: 'unchanged', packedFilesVerified: verifyArchiveIntegrity(loaded.archive) };
  }
  const isUpdate = loaded.state?.status === 'installed';
  const replacements = new Map<string, Buffer>(), additions = new Map<string, Buffer>();
  const main = isUpdate ? readEntry(loaded.archive, pins.module) : proposedMain(readEntry(loaded.archive, pins.module), pins);
  replacements.set(pins.module, main);
  for (const [name, bytes] of [[RUNTIME, shim.code], [RUNTIME_PACKAGE, shim.metadata]] as const) {
    (isUpdate ? replacements : additions).set(name, bytes);
  }
  const archive = rebuildArchive(loaded.archive, replacements, additions);
  const metadata = structuredClone(loaded.metadata);
  metadata.ElectronAsarIntegrity['Resources/app.asar'].hash = digest(parseArchive(archive).headerBytes);
  const plist = encodePlist(metadata, loaded.plist);
  checkHeader(archive, decodePlist(plist));
  const packedFilesVerified = verifyArchiveIntegrity(archive);
  const finalState: State = { ...originalState(loaded.paths, pins), status: 'installed',
    archiveSha256: digest(archive), plistSha256: digest(plist), moduleSha256: digest(main),
    shimSha256: digest(shim.code), shimVersion: shim.version };
  return { loaded, archive, plist, finalState, operation: isUpdate ? 'update' : 'install', packedFilesVerified };
}
export function inspect(options: Options, pins: Pins = baseline): Record<string, unknown> {
  const paths = pathsOf(options.app);
  if (fs.existsSync(paths.journal)) return { status: 'interrupted', target: paths.app, changed: false,
    backup: paths.backup, lockPresent: fs.existsSync(paths.lock), recovery: 'restore --offline-copy --recover-pending' };
  const loaded = load(options, pins);
  return { status: loaded.state?.status === 'installed' ? 'installed' : 'supported-original', changed: false,
    target: paths.app, version: pins.appVersion, archiveSha256: digest(loaded.archive),
    plistSha256: digest(loaded.plist), moduleSha256: digest(readEntry(loaded.archive, pins.module)),
    shimVersion: loaded.state?.shimVersion, backup: loaded.state ? paths.backup : undefined,
    packedFilesVerified: verifyArchiveIntegrity(loaded.archive), lockPresent: fs.existsSync(paths.lock),
    signaturePresent: fs.existsSync(path.join(paths.app, 'Contents/_CodeSignature/CodeResources')),
    liveMutationSupported: false, defaultRouting: 'native',
    implications: ['ASAR file/block hashes and plist header hash must change together',
      'A modified signed copy has a stale vendor signature; no signing or launch is performed',
      'Mutation commands require an offline copy and refuse Applications directories'] };
}
export function dryRun(options: Options, pins: Pins = baseline): Record<string, unknown> {
  const plan = planInstall(options, pins);
  return { status: 'dry-run', changed: false, operation: plan.operation, target: plan.loaded.paths.app,
    sourceByteOffset: pins.moduleByteOffset, beforeArchiveSha256: digest(plan.loaded.archive),
    proposedArchiveSha256: digest(plan.archive), proposedPlistSha256: digest(plan.plist),
    proposedModuleSha256: plan.finalState.moduleSha256, shimSha256: plan.finalState.shimSha256,
    shimVersion: plan.finalState.shimVersion, packedFilesVerified: plan.packedFilesVerified,
    backupWouldBe: plan.loaded.paths.backup, signatureConsequence: 'vendor signature becomes stale if artifact changes',
    applied: false, defaultRouting: 'native' };
}
export function install(options: Options, pins: Pins = baseline): Record<string, unknown> {
  const paths = pathsOf(options.app); assertOffline(paths, options);
  return withLock(paths, false, () => {
    const plan = planInstall(options, pins);
    if (plan.operation === 'unchanged') return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
    ensureBackup(plan.loaded, pins);
    transaction(plan.loaded, plan.archive, plan.plist, plan.finalState, options);
    return { ...inspect(options, pins), lockPresent: false, changed: true, operation: plan.operation,
      signatureConsequence: 'offline artifact changed; not signed or launched' };
  });
}
export function restore(options: Options, pins: Pins = baseline): Record<string, unknown> {
  const paths = pathsOf(options.app); assertOffline(paths, options);
  return withLock(paths, options.recoverPending === true, () => {
    const pending = fs.existsSync(paths.journal);
    if (pending && !options.recoverPending) refuse('pending-recovery-flag-required');
    const loaded = load(options, pins, pending);
    if (!loaded.state) return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
    const original = originalBackups(paths, pins);
    if (pending) {
      const journal = parseJson<Journal>(paths.journal, 'invalid-transaction-journal');
      if (journal.format !== 1 || journal.owner !== OWNER || journal.target !== paths.app) refuse('journal-owner-conflict');
      if (![journal.beforeArchive, journal.afterArchive].includes(digest(loaded.archive))
        || ![journal.beforePlist, journal.afterPlist].includes(digest(loaded.plist))) refuse('pending-artifact-conflict');
      for (const [name, hash] of [['before.asar', journal.beforeArchive], ['before.Info.plist', journal.beforePlist],
        ['before.state.json', journal.beforeState]]) {
        const file = path.join(paths.backup, name); regularFile(file);
        if (digest(fs.readFileSync(file)) !== hash) refuse('pending-snapshot-conflict');
      }
      atomicWrite(paths.asar, original.archive, fs.statSync(paths.asar).mode);
      atomicWrite(paths.plist, original.plist, fs.statSync(paths.plist).mode);
      atomicWrite(paths.state, jsonBytes(originalState(paths, pins)));
      removeTransactionFiles(paths);
      return { ...inspect(options, pins), lockPresent: false, changed: true, operation: 'recovered-original' };
    }
    if (loaded.state.status === 'restored') return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
    transaction(loaded, original.archive, original.plist, originalState(paths, pins), options);
    return { ...inspect(options, pins), lockPresent: false, changed: true, operation: 'restored-original' };
  });
}
export { Refusal };
