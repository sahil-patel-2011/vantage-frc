# Legacy media archive

*For operators preserving previously stored files. Updated 2026-09-26.*

Vantage no longer offers photo/video uploads, capture, recording or storage-node setup. External match-video links remain available. Supported documents, PDF financial receipts and CAD artifacts use their own workflows.

Existing files and database records are retained. `packages/storage-node/server.mjs` can serve an existing archive using its existing access configuration; it cannot provision a new node or accept uploads. The retired connector capability is not a setup option.

## How it works (and what it honestly cannot do)

Authenticated `GET` and `HEAD /items/<sha256>` retrieve existing files, including byte ranges. Archive responses use private, non-persistent browser caching. The standalone server also accepts existing scoped download grants. `GET /health` identifies the service as archive-only.

New item writes return HTTP 410. The standalone server rejects every upload-session endpoint. Startup preserves partial legacy files and does not run upload, heartbeat, quota or cleanup workers. Missing files return 404; unavailable hardware cannot be presented as a successful download.

An explicit authenticated `DELETE /items/<sha256>` remains available to remove an identified archive file. A scoped download grant cannot authorize deletion on the standalone server. Stopping the service does not delete files.

### The networking truth

Archive access requires a reachable address. The service does not provide a cloud relay or automatically update an address. Preserve the existing network configuration and access controls when maintaining an archive. A healthy local service does not prove that a remote browser can reach it.

## Raspberry Pi setup

New storage-node setup is retired, including `--setup`. For an **existing** installation with Node.js 20 or later and its original configuration, run:

```sh
node packages/storage-node/server.mjs --dir /path/to/existing/archive --port 8788
```

Keep access keys and tokens private. Do not print or commit `config.json`. Copy the configuration and files together when moving an existing archive; do not create an empty replacement and claim the files were restored.

## Flags

| Flag | Current behavior |
| --- | --- |
| `--dir DIR` | Existing data directory; defaults to `VANTAGE_STORAGE_DIR` or `./vantage-storage` |
| `--port N` | Listening port; default 8788, or the saved port |
| `--allow-origin URL` | Adds an explicitly allowed browser origin to the saved allowlist |
| `--help` | Shows the archive command |
| `--setup` | Fails immediately; no pairing or resources are created |

Legacy name, cloud and quota fields may remain in configuration for compatibility. They do not enable uploads or background workers.

## On-disk layout

```text
<dir>/config.json            # existing private access configuration
<dir>/items/ab/cd/abcd…      # existing content-addressed bytes
<dir>/items/ab/cd/abcd….json # existing content type and metadata
<dir>/tmp/ or uploads/      # retained partial legacy files, if present
```

Back up the configuration and complete item tree before moving hardware. Verify hashes and representative authenticated reads after restoration. Startup does not discard unfinished files.

## Unpairing / decommissioning

Stop the service to end local serving. Revoking cloud registration does not automatically stop a process or erase its disk. Preserve an offline copy and reconcile references before intentionally deleting an identified archive. Media retirement itself performs no deletion.

## Cloud API surface (for feature integration)

Pairing, heartbeat, storage registration, upload and media mutation routes are retired. Existing authorized archive resolution or removal may remain for previously registered records. Callers must show actual missing/unreachable errors and must not advertise storage setup or upload quotas.

Supported documents and external video links are separate from this archive. Their authorization, retention and acceptance checks remain part of the [production plan](release/PLAN.md).
