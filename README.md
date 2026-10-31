# Grokbot Constellation shim

Experimental TypeScript code for selectively routing text from a locally copied Grok Bot 0.78.1 app to an OpenAI-compatible Constellation router. This is a research prototype: the per-chat extension has offline tests but has not been deployed or verified in a live app. The original app, its source, bundles and user data are not included.

The router text path is not the native tool loop. It lacks native tools, hidden system instructions, attachments and streaming. Visible history may contain unsupported rows or be incomplete; the adapter refuses those cases. Locally saved routed turns are not committed to the native service and native mode may not see them. Its journal stores conversation text in plaintext in the local data directory. Use only with an account and router you control.

## Build and test

Requires Node.js 20 or later, TypeScript 5.9.3 and the Node types specified in `package.json`.

```sh
npm install
npm run build
npm test
```

Set `CXN_ROUTER_ORIGIN` to your HTTPS router origin. The default `https://router.example` is an intentionally nonfunctional example. Store your own router key as `CXN_API_KEY=...` in `~/.config/cxn.env`; do not commit that file. The prototype requests `GET /v1/models` and `POST /v1/chat/completions` from that origin. Redirects are rejected. Model IDs must match the router catalog exactly.

The per-chat proposal supports `/router-on`, `/router-off`, `/cxn-list`, `/cxn-model <exact-id>` and `/cxn-status`. Model-list checks do not generate inference. Model and route choices are per conversation. A stale catalog is labeled, and model discovery failure retains the last successful list.

## Installer and rollback

The separately built TypeScript installer in `installer/` is a version/hash-guarded **pass-through transport** installer for disposable offline app copies; it does not install the experimental per-chat adapter. See [installer/README.md](installer/README.md) for inspect, dry-run, install, verify and uninstall commands. It backs up original bytes and refuses unsupported versions. It does not sign or launch the app.

The `lab/` scripts document a separate, unfinished coordinator-adapter experiment against a previously prepared lab copy. They expect exact pinned app and preceding patch hashes and are not a general-purpose installer. The experiment alters a signed copy, so signing and application-integrity requirements apply; no bypass of OS protections is included. Back up a copy before testing and use the script's restore operation to recover its pre-update bytes. Do not point the experiment at your installed application or active profile. Live installation, renderer behavior and tool compatibility remain unverified.
