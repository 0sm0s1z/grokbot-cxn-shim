# TypeScript offline installer

This is a separate TypeScript program for Grok Bot **0.78.1**. It patches only disposable offline copies. It never launches the app, attaches to a process, changes observers, signs code, changes fuses, or changes trust. Mutation commands require `--offline-copy` and refuse system and per-user Applications directories, including `/Applications/Grok Bot.app`.

The default shim returns the original transport. Installing it enables no inspection or routing.

## Run with Node or Bun

Run these commands from the parent `grokbot-connect-shim` directory. Compiled JavaScript is included; Node needs no dependency installation. Both execution forms were tested with Node 26.8.1 and Bun 1.4.0 on Sephiroth.

```text
node installer/dist/cli.cjs <command> --app <path> [options]
bun installer/src/cli.cts <command> --app <path> [options]
```

The source is TypeScript (`.cts`); Node runs the compiled `.cjs` output. Bun runs the TypeScript directly. The tool is macOS-specific and invokes `/usr/bin/plutil` with argument arrays and stdin to read/write plist data in memory. It uses no shell scripts or shell command execution.

Read-only inspection of the installed artifact:

```sh
node installer/dist/cli.cjs inspect --app "/Applications/Grok Bot.app"
bun installer/src/cli.cts status --app "/Applications/Grok Bot.app"
```

For a usable, non-runnable test fixture, choose a new output path whose parent exists:

```sh
node installer/dist/prepare-fixture.cjs --source-app "/Applications/Grok Bot.app" --out "/tmp/Grok Bot Offline Fixture.app"
```

This copies only the verified ASAR and `Info.plist`. It does not copy app executables, app data, credentials, or an active session. An existing output path is refused. The result is explicitly marked as an offline fixture.

Then exercise the complete CLI against that fixture:

```sh
node installer/dist/cli.cjs dry-run --app "/tmp/Grok Bot Offline Fixture.app" --shim-package .
node installer/dist/cli.cjs install --app "/tmp/Grok Bot Offline Fixture.app" --shim-package . --offline-copy
bun installer/src/cli.cts verify --app "/tmp/Grok Bot Offline Fixture.app"
node installer/dist/cli.cjs status --app "/tmp/Grok Bot Offline Fixture.app"
node installer/dist/cli.cjs uninstall --app "/tmp/Grok Bot Offline Fixture.app" --offline-copy
```

`restore` is an alias for restoration of the original bytes:

```sh
node installer/dist/cli.cjs restore --app "/tmp/Grok Bot Offline Fixture.app" --offline-copy
```

All output is structured JSON containing status, artifact hashes, paths, package version, and packaging consequences. It contains no request payloads, credentials, or transcript content. Unknown commands/options and ambiguous versions are refused.

## Exact supported artifact and insertion

`baseline.json` pins bundle ID, both version strings, full ASAR SHA-256, ASAR-header SHA-256, original plist SHA-256, module SHA-256, and the exact unique `gOe` function at UTF-8 byte **360729**. No fuzzy matching or alternate-version patch is attempted. The installed main module must match either that original or this installer's recorded result backed by the pinned original bytes.

The insertion wraps only the result of `e8t` inside `gOe` with:

```js
require("./grokbot-connect-shim/index.cjs").wrapConnectTransport(originalTransport)
```

The exact original/replacement strings are in `baseline.json`. The shim runtime and a minimal package manifest are added under `dist/electron-main/grokbot-connect-shim/` inside ASAR. TypeScript source files and test files are not put into the app.

The writer preserves all unrelated entry bodies and header fields, updates packed-file offsets deterministically, updates changed/new file and block hashes, rebuilds the ASAR pickle/header, and updates `ElectronAsarIntegrity` in the plist. It verifies every resulting packed-file/block hash before writing. A dry-run computes the same proposed hashes without creating a backup, lock, or staging file.

## Backups, updates, and recovery

The backup directory is a sibling of the target app: `<app>.grokbot-shim-backup`. It contains exact original `app.asar` and `Info.plist` bytes, their pinned hashes, and an owner/versioned state record. Originals are never replaced during a package update. Backups remain after uninstall.

Each target file is written to an exclusive temporary file in its own directory, flushed, and atomically renamed. A durable transaction journal and before-images cover the two target files and installer state. An ordinary failure rolls back all three to the previous state, including the previous installed package during an update. Tests inject failure after each replacement.

**ASAR and plist are two files; their replacements are not a single filesystem-wide atomic operation.** A crash between renames can leave a detectable interrupted transaction. Further installation is refused until explicit restoration. This is transactional recovery using atomic file replacement, not an atomic whole-bundle swap. Directory flushes use the filesystem's available support.

After confirming that no other instance of this installer is active, explicit recovery of an interrupted offline fixture is:

```sh
node installer/dist/cli.cjs restore --app "/tmp/Grok Bot Offline Fixture.app" --offline-copy --recover-pending
```

That flag can remove only a lock with this installer's matching owner/target record. It does not inspect, kill, or control any process. Recovery verifies the journal and before-image hashes, refuses unrelated file changes, and restores the original ASAR/plist. A corrupt backup or unknown lock is refused.

Re-running `install` with the same compiled shim/version is a no-op. Re-running it with a new standalone shim package version or code hash updates only the two embedded runtime package files; the main insertion remains identical and original backups remain unchanged. Repacking and signature consequences still apply to an update. A package must have the expected name, `main: "index.cjs"`, and no runtime dependencies; the installer does not evaluate its code.

`verify` and `status` use the same read-only verification. Idempotent uninstall restores exact original ASAR and plist bytes, removing the embedded runtime by restoring the archive. It does not delete app data or alter observers.

## Signature and integrity boundary

The original artifact has ASAR file/block hashes and a plist hash over the ASAR JSON header. Framework fuse inspection found embedded ASAR integrity and ASAR-only loading enabled, with Node options, Node inspection, and run-as-Node disabled.

The original code-signing description reports hardened runtime, sealed resources, an embedded signature, and a stapled ticket. Static inspection of `Contents/_CodeSignature/CodeResources` confirms that its `files2["Resources/app.asar"].hash2` matches the original ASAR SHA-256. Changing that ASAR leaves this original resource seal stale even when the new internal ASAR hashes are consistent. The receipt is `../proposal/resource-seal-evidence.json`. This installer neither verifies signature trust nor repairs or bypasses signing/notarization. It does not modify `_CodeSignature`, a signing identity, certificates, or fuses.

The original live app remains untouched. A real installation needs a separately approved build/signing/distribution approach. This CLI intentionally cannot perform live installation into Applications directories. A successful offline fixture verification is an integrity/rollback proof, not evidence that macOS or Electron will launch a modified signed app.

## Build and tests

With the pinned development dependencies available in the parent package:

```sh
npm run build
npm run fixture:shipped
npm test
```

`fixture:shipped` creates a new local snapshot from the supported original app. The snapshot is not included in distributable archives. Synthetic tests always run; the shipped-ASAR case runs when that snapshot exists. The shipped case exercises Node dry-run/install, Bun TypeScript verification, idempotence, all 857 resulting packed-file/block records, uninstall, and exact original-byte restoration. It never executes the app or embedded shim.
