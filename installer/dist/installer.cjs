"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Refusal = exports.baseline = void 0;
exports.isLiveAppPath = isLiveAppPath;
exports.inspect = inspect;
exports.dryRun = dryRun;
exports.install = install;
exports.restore = restore;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const asar_cts_1 = require("./asar.cjs");
Object.defineProperty(exports, "Refusal", { enumerable: true, get: function () { return asar_cts_1.Refusal; } });
const plist_cts_1 = require("./plist.cjs");
exports.baseline = require('../baseline.json');
const OWNER = 'grokbot-connect-shim-installer';
const RUNTIME = 'dist/electron-main/grokbot-connect-shim/index.cjs';
const RUNTIME_PACKAGE = 'dist/electron-main/grokbot-connect-shim/package.json';
const STATE_VERSION = 1;
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function regularFile(name) {
    const stat = fs.lstatSync(name);
    if (!stat.isFile() || stat.isSymbolicLink())
        (0, asar_cts_1.refuse)('target-file-not-regular');
}
function pathsOf(app) {
    const resolved = fs.realpathSync(app);
    if (!fs.statSync(resolved).isDirectory())
        (0, asar_cts_1.refuse)('app-target-not-directory');
    const asar = path.join(resolved, 'Contents/Resources/app.asar');
    const plist = path.join(resolved, 'Contents/Info.plist');
    for (const target of [asar, plist]) {
        regularFile(target);
        if (!fs.realpathSync(target).startsWith(resolved + path.sep))
            (0, asar_cts_1.refuse)('target-file-outside-app');
    }
    const backup = resolved + '.grokbot-shim-backup';
    if (fs.existsSync(backup) && (fs.lstatSync(backup).isSymbolicLink() || !fs.statSync(backup).isDirectory()))
        (0, asar_cts_1.refuse)('backup-path-conflict');
    return { app: resolved, asar, plist, backup, state: path.join(backup, 'state.json'),
        journal: path.join(backup, 'transaction.json'), lock: resolved + '.grokbot-shim-lock' };
}
function isLiveAppPath(app) {
    return /^\/(?:System\/)?Applications(?:\/|$)/i.test(app)
        || /^\/Users\/[^/]+\/Applications(?:\/|$)/i.test(app);
}
function assertOffline(paths, options) {
    if (!options.offlineCopy)
        (0, asar_cts_1.refuse)('mutation-requires-offline-copy');
    if (isLiveAppPath(paths.app))
        (0, asar_cts_1.refuse)('live-app-mutation-refused');
}
function parseJson(name, code) {
    regularFile(name);
    try {
        return JSON.parse(fs.readFileSync(name, 'utf8'));
    }
    catch {
        (0, asar_cts_1.refuse)(code);
    }
}
function stateOf(paths, pins) {
    if (!fs.existsSync(paths.state)) {
        if (fs.existsSync(paths.backup))
            (0, asar_cts_1.refuse)('incomplete-backup-refused');
        return undefined;
    }
    const state = parseJson(paths.state, 'invalid-backup-state');
    if (state.format !== STATE_VERSION || state.owner !== OWNER || state.target !== paths.app
        || !['installed', 'restored'].includes(state.status)
        || state.originalArchiveSha256 !== pins.archiveSha256 || state.originalPlistSha256 !== pins.infoPlistSha256
        || ![state.archiveSha256, state.plistSha256, state.moduleSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))) {
        (0, asar_cts_1.refuse)('backup-state-conflict');
    }
    return state;
}
function checkIdentity(metadata, pins) {
    if (metadata.CFBundleShortVersionString !== pins.appVersion || metadata.CFBundleVersion !== pins.bundleVersion
        || metadata.CFBundleIdentifier !== pins.bundleIdentifier)
        (0, asar_cts_1.refuse)('app-version-or-identity-conflict');
}
function checkHeader(archive, metadata) {
    const hash = (0, asar_cts_1.digest)((0, asar_cts_1.parseArchive)(archive).headerBytes);
    const recorded = metadata.ElectronAsarIntegrity?.['Resources/app.asar'];
    if (recorded?.algorithm !== 'SHA256' || recorded.hash !== hash)
        (0, asar_cts_1.refuse)('plist-asar-integrity-conflict');
}
function proposedMain(original, pins) {
    if ((0, asar_cts_1.digest)(original) !== pins.moduleSha256)
        (0, asar_cts_1.refuse)('original-main-hash-conflict');
    const needle = Buffer.from(pins.original);
    const at = original.indexOf(needle);
    if (at !== pins.moduleByteOffset || original.indexOf(needle, at + 1) !== -1)
        (0, asar_cts_1.refuse)('source-anchor-conflict');
    return Buffer.concat([original.subarray(0, at), Buffer.from(pins.proposed), original.subarray(at + needle.length)]);
}
function checkOriginal(archive, plist, pins) {
    if ((0, asar_cts_1.digest)(archive) !== pins.archiveSha256 || (0, asar_cts_1.digest)(plist) !== pins.infoPlistSha256)
        (0, asar_cts_1.refuse)('unsupported-original-artifact');
    const metadata = (0, plist_cts_1.decodePlist)(plist);
    checkIdentity(metadata, pins);
    checkHeader(archive, metadata);
    if ((0, asar_cts_1.digest)((0, asar_cts_1.parseArchive)(archive).headerBytes) !== pins.archiveHeaderSha256)
        (0, asar_cts_1.refuse)('original-header-hash-conflict');
    proposedMain((0, asar_cts_1.readEntry)(archive, pins.module), pins);
}
function originalBackups(paths, pins) {
    const archivePath = path.join(paths.backup, 'original.asar');
    const plistPath = path.join(paths.backup, 'original.Info.plist');
    regularFile(archivePath);
    regularFile(plistPath);
    const archive = fs.readFileSync(archivePath), plist = fs.readFileSync(plistPath);
    checkOriginal(archive, plist, pins);
    return { archive, plist };
}
function load(options, pins, allowPending = false) {
    const paths = pathsOf(options.app);
    if (fs.existsSync(paths.journal) && !allowPending)
        (0, asar_cts_1.refuse)('interrupted-transaction-requires-restore');
    const state = stateOf(paths, pins);
    const archive = fs.readFileSync(paths.asar), plist = fs.readFileSync(paths.plist), metadata = (0, plist_cts_1.decodePlist)(plist);
    checkIdentity(metadata, pins);
    if (!allowPending) {
        checkHeader(archive, metadata);
        if (state?.status === 'installed') {
            const originals = originalBackups(paths, pins);
            if ((0, asar_cts_1.digest)(archive) !== state.archiveSha256 || (0, asar_cts_1.digest)(plist) !== state.plistSha256
                || (0, asar_cts_1.digest)((0, asar_cts_1.readEntry)(archive, pins.module)) !== state.moduleSha256
                || (0, asar_cts_1.digest)((0, asar_cts_1.readEntry)(archive, RUNTIME)) !== state.shimSha256)
                (0, asar_cts_1.refuse)('installed-artifact-conflict');
            const originalMain = (0, asar_cts_1.readEntry)(originals.archive, pins.module);
            if ((0, asar_cts_1.digest)(proposedMain(originalMain, pins)) !== state.moduleSha256)
                (0, asar_cts_1.refuse)('installed-source-anchor-conflict');
        }
        else {
            checkOriginal(archive, plist, pins);
            if (state)
                originalBackups(paths, pins);
        }
    }
    return { paths, archive, plist, metadata, state };
}
function originalState(paths, pins) {
    return { format: 1, owner: OWNER, target: paths.app, status: 'restored',
        originalArchiveSha256: pins.archiveSha256, originalPlistSha256: pins.infoPlistSha256,
        archiveSha256: pins.archiveSha256, plistSha256: pins.infoPlistSha256, moduleSha256: pins.moduleSha256 };
}
function fsyncDirectory(name) {
    const descriptor = fs.openSync(name, 'r');
    try {
        fs.fsyncSync(descriptor);
    }
    catch (error) {
        if (!['EINVAL', 'ENOTSUP'].includes(error.code ?? ''))
            throw error;
    }
    finally {
        fs.closeSync(descriptor);
    }
}
function stageFile(target, bytes, mode) {
    const temporary = path.join(path.dirname(target), '.' + path.basename(target) + '.grokbot-' + (0, node_crypto_1.randomUUID)());
    const descriptor = fs.openSync(temporary, 'wx', mode & 0o777);
    try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
    }
    catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
    finally {
        fs.closeSync(descriptor);
    }
    return temporary;
}
function atomicWrite(target, bytes, mode = 0o600) {
    const temporary = stageFile(target, bytes, mode);
    try {
        fs.renameSync(temporary, target);
        fsyncDirectory(path.dirname(target));
    }
    finally {
        fs.rmSync(temporary, { force: true });
    }
}
function ensureBackup(loaded, pins) {
    if (loaded.state)
        return loaded.state;
    fs.mkdirSync(loaded.paths.backup, { mode: 0o700 });
    try {
        atomicWrite(path.join(loaded.paths.backup, 'original.asar'), loaded.archive);
        atomicWrite(path.join(loaded.paths.backup, 'original.Info.plist'), loaded.plist);
        const state = originalState(loaded.paths, pins);
        atomicWrite(loaded.paths.state, jsonBytes(state));
        return state;
    }
    catch (error) {
        fs.rmSync(loaded.paths.backup, { recursive: true, force: true });
        throw error;
    }
}
function removeTransactionFiles(paths) {
    for (const name of ['transaction.json', 'before.asar', 'before.Info.plist', 'before.state.json']) {
        fs.rmSync(path.join(paths.backup, name), { force: true });
    }
    fsyncDirectory(paths.backup);
}
function transaction(loaded, archive, plist, state, options) {
    const { paths } = loaded;
    const beforeState = fs.readFileSync(paths.state);
    atomicWrite(path.join(paths.backup, 'before.asar'), loaded.archive);
    atomicWrite(path.join(paths.backup, 'before.Info.plist'), loaded.plist);
    atomicWrite(path.join(paths.backup, 'before.state.json'), beforeState);
    const journal = { format: 1, owner: OWNER, target: paths.app,
        beforeArchive: (0, asar_cts_1.digest)(loaded.archive), beforePlist: (0, asar_cts_1.digest)(loaded.plist), beforeState: (0, asar_cts_1.digest)(beforeState),
        afterArchive: (0, asar_cts_1.digest)(archive), afterPlist: (0, asar_cts_1.digest)(plist) };
    const asarMode = fs.statSync(paths.asar).mode, plistMode = fs.statSync(paths.plist).mode;
    const stagedAsar = stageFile(paths.asar, archive, asarMode);
    let stagedPlist;
    let started = false;
    try {
        stagedPlist = stageFile(paths.plist, plist, plistMode);
        // Refuse a concurrent artifact change, even if it did not use this installer's lock.
        if ((0, asar_cts_1.digest)(fs.readFileSync(paths.asar)) !== journal.beforeArchive
            || (0, asar_cts_1.digest)(fs.readFileSync(paths.plist)) !== journal.beforePlist)
            (0, asar_cts_1.refuse)('artifact-changed-during-staging');
        atomicWrite(paths.journal, jsonBytes(journal));
        started = true;
        fs.renameSync(stagedAsar, paths.asar);
        fsyncDirectory(path.dirname(paths.asar));
        if (options.testFaultAt === 'after-asar')
            (0, asar_cts_1.refuse)('injected-transaction-failure');
        fs.renameSync(stagedPlist, paths.plist);
        fsyncDirectory(path.dirname(paths.plist));
        if (options.testFaultAt === 'after-plist')
            (0, asar_cts_1.refuse)('injected-transaction-failure');
        atomicWrite(paths.state, jsonBytes(state));
        if (options.testFaultAt === 'after-state')
            (0, asar_cts_1.refuse)('injected-transaction-failure');
        if ((0, asar_cts_1.digest)(fs.readFileSync(paths.asar)) !== journal.afterArchive
            || (0, asar_cts_1.digest)(fs.readFileSync(paths.plist)) !== journal.afterPlist)
            (0, asar_cts_1.refuse)('committed-file-hash-mismatch');
        removeTransactionFiles(paths);
    }
    catch (error) {
        if (started) {
            try {
                atomicWrite(paths.asar, loaded.archive, asarMode);
                atomicWrite(paths.plist, loaded.plist, plistMode);
                atomicWrite(paths.state, beforeState);
                removeTransactionFiles(paths);
            }
            catch {
                (0, asar_cts_1.refuse)('rollback-incomplete-restore-required');
            }
        }
        else
            removeTransactionFiles(paths);
        throw error;
    }
    finally {
        fs.rmSync(stagedAsar, { force: true });
        if (stagedPlist)
            fs.rmSync(stagedPlist, { force: true });
    }
}
function withLock(paths, recoverPending, run) {
    if (fs.existsSync(paths.lock) && recoverPending) {
        if (fs.lstatSync(paths.lock).isSymbolicLink())
            (0, asar_cts_1.refuse)('lock-path-conflict');
        const owner = parseJson(path.join(paths.lock, 'owner.json'), 'invalid-lock-owner');
        if (owner.owner !== OWNER || owner.target !== paths.app)
            (0, asar_cts_1.refuse)('lock-owner-conflict');
        fs.rmSync(paths.lock, { recursive: true });
    }
    try {
        fs.mkdirSync(paths.lock, { mode: 0o700 });
    }
    catch (error) {
        if (error.code === 'EEXIST')
            (0, asar_cts_1.refuse)('installer-lock-present');
        throw error;
    }
    try {
        atomicWrite(path.join(paths.lock, 'owner.json'), jsonBytes({ owner: OWNER, target: paths.app }));
        return run();
    }
    finally {
        fs.rmSync(paths.lock, { recursive: true, force: true });
    }
}
function runtimePackage(root) {
    if (!root)
        (0, asar_cts_1.refuse)('shim-package-path-required');
    const manifest = parseJson(path.join(root, 'package.json'), 'invalid-shim-package');
    if (manifest.name !== '@local/grokbot-connect-shim' || manifest.main !== 'index.cjs'
        || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)
        || Object.keys(manifest.dependencies ?? {}).length !== 0)
        (0, asar_cts_1.refuse)('unsupported-shim-package');
    const runtime = path.join(root, 'index.cjs');
    regularFile(runtime);
    const code = fs.readFileSync(runtime);
    if (code.length < 1 || code.length > 1024 * 1024)
        (0, asar_cts_1.refuse)('unsupported-shim-runtime-size');
    return { code, version: manifest.version, metadata: jsonBytes({ name: manifest.name, version: manifest.version, private: true, main: 'index.cjs' }) };
}
function planInstall(options, pins) {
    const loaded = load(options, pins);
    const shim = runtimePackage(options.shimPackage);
    if (loaded.state?.status === 'installed' && loaded.state.shimSha256 === (0, asar_cts_1.digest)(shim.code)
        && loaded.state.shimVersion === shim.version) {
        return { loaded, archive: loaded.archive, plist: loaded.plist, finalState: loaded.state,
            operation: 'unchanged', packedFilesVerified: (0, asar_cts_1.verifyArchiveIntegrity)(loaded.archive) };
    }
    const isUpdate = loaded.state?.status === 'installed';
    const replacements = new Map(), additions = new Map();
    const main = isUpdate ? (0, asar_cts_1.readEntry)(loaded.archive, pins.module) : proposedMain((0, asar_cts_1.readEntry)(loaded.archive, pins.module), pins);
    replacements.set(pins.module, main);
    for (const [name, bytes] of [[RUNTIME, shim.code], [RUNTIME_PACKAGE, shim.metadata]]) {
        (isUpdate ? replacements : additions).set(name, bytes);
    }
    const archive = (0, asar_cts_1.rebuildArchive)(loaded.archive, replacements, additions);
    const metadata = structuredClone(loaded.metadata);
    metadata.ElectronAsarIntegrity['Resources/app.asar'].hash = (0, asar_cts_1.digest)((0, asar_cts_1.parseArchive)(archive).headerBytes);
    const plist = (0, plist_cts_1.encodePlist)(metadata, loaded.plist);
    checkHeader(archive, (0, plist_cts_1.decodePlist)(plist));
    const packedFilesVerified = (0, asar_cts_1.verifyArchiveIntegrity)(archive);
    const finalState = { ...originalState(loaded.paths, pins), status: 'installed',
        archiveSha256: (0, asar_cts_1.digest)(archive), plistSha256: (0, asar_cts_1.digest)(plist), moduleSha256: (0, asar_cts_1.digest)(main),
        shimSha256: (0, asar_cts_1.digest)(shim.code), shimVersion: shim.version };
    return { loaded, archive, plist, finalState, operation: isUpdate ? 'update' : 'install', packedFilesVerified };
}
function inspect(options, pins = exports.baseline) {
    const paths = pathsOf(options.app);
    if (fs.existsSync(paths.journal))
        return { status: 'interrupted', target: paths.app, changed: false,
            backup: paths.backup, lockPresent: fs.existsSync(paths.lock), recovery: 'restore --offline-copy --recover-pending' };
    const loaded = load(options, pins);
    return { status: loaded.state?.status === 'installed' ? 'installed' : 'supported-original', changed: false,
        target: paths.app, version: pins.appVersion, archiveSha256: (0, asar_cts_1.digest)(loaded.archive),
        plistSha256: (0, asar_cts_1.digest)(loaded.plist), moduleSha256: (0, asar_cts_1.digest)((0, asar_cts_1.readEntry)(loaded.archive, pins.module)),
        shimVersion: loaded.state?.shimVersion, backup: loaded.state ? paths.backup : undefined,
        packedFilesVerified: (0, asar_cts_1.verifyArchiveIntegrity)(loaded.archive), lockPresent: fs.existsSync(paths.lock),
        signaturePresent: fs.existsSync(path.join(paths.app, 'Contents/_CodeSignature/CodeResources')),
        liveMutationSupported: false, defaultRouting: 'native',
        implications: ['ASAR file/block hashes and plist header hash must change together',
            'A modified signed copy has a stale vendor signature; no signing or launch is performed',
            'Mutation commands require an offline copy and refuse Applications directories'] };
}
function dryRun(options, pins = exports.baseline) {
    const plan = planInstall(options, pins);
    return { status: 'dry-run', changed: false, operation: plan.operation, target: plan.loaded.paths.app,
        sourceByteOffset: pins.moduleByteOffset, beforeArchiveSha256: (0, asar_cts_1.digest)(plan.loaded.archive),
        proposedArchiveSha256: (0, asar_cts_1.digest)(plan.archive), proposedPlistSha256: (0, asar_cts_1.digest)(plan.plist),
        proposedModuleSha256: plan.finalState.moduleSha256, shimSha256: plan.finalState.shimSha256,
        shimVersion: plan.finalState.shimVersion, packedFilesVerified: plan.packedFilesVerified,
        backupWouldBe: plan.loaded.paths.backup, signatureConsequence: 'vendor signature becomes stale if artifact changes',
        applied: false, defaultRouting: 'native' };
}
function install(options, pins = exports.baseline) {
    const paths = pathsOf(options.app);
    assertOffline(paths, options);
    return withLock(paths, false, () => {
        const plan = planInstall(options, pins);
        if (plan.operation === 'unchanged')
            return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
        ensureBackup(plan.loaded, pins);
        transaction(plan.loaded, plan.archive, plan.plist, plan.finalState, options);
        return { ...inspect(options, pins), lockPresent: false, changed: true, operation: plan.operation,
            signatureConsequence: 'offline artifact changed; not signed or launched' };
    });
}
function restore(options, pins = exports.baseline) {
    const paths = pathsOf(options.app);
    assertOffline(paths, options);
    return withLock(paths, options.recoverPending === true, () => {
        const pending = fs.existsSync(paths.journal);
        if (pending && !options.recoverPending)
            (0, asar_cts_1.refuse)('pending-recovery-flag-required');
        const loaded = load(options, pins, pending);
        if (!loaded.state)
            return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
        const original = originalBackups(paths, pins);
        if (pending) {
            const journal = parseJson(paths.journal, 'invalid-transaction-journal');
            if (journal.format !== 1 || journal.owner !== OWNER || journal.target !== paths.app)
                (0, asar_cts_1.refuse)('journal-owner-conflict');
            if (![journal.beforeArchive, journal.afterArchive].includes((0, asar_cts_1.digest)(loaded.archive))
                || ![journal.beforePlist, journal.afterPlist].includes((0, asar_cts_1.digest)(loaded.plist)))
                (0, asar_cts_1.refuse)('pending-artifact-conflict');
            for (const [name, hash] of [['before.asar', journal.beforeArchive], ['before.Info.plist', journal.beforePlist],
                ['before.state.json', journal.beforeState]]) {
                const file = path.join(paths.backup, name);
                regularFile(file);
                if ((0, asar_cts_1.digest)(fs.readFileSync(file)) !== hash)
                    (0, asar_cts_1.refuse)('pending-snapshot-conflict');
            }
            atomicWrite(paths.asar, original.archive, fs.statSync(paths.asar).mode);
            atomicWrite(paths.plist, original.plist, fs.statSync(paths.plist).mode);
            atomicWrite(paths.state, jsonBytes(originalState(paths, pins)));
            removeTransactionFiles(paths);
            return { ...inspect(options, pins), lockPresent: false, changed: true, operation: 'recovered-original' };
        }
        if (loaded.state.status === 'restored')
            return { ...inspect(options, pins), lockPresent: false, operation: 'unchanged' };
        transaction(loaded, original.archive, original.plist, originalState(paths, pins), options);
        return { ...inspect(options, pins), lockPresent: false, changed: true, operation: 'restored-original' };
    });
}
