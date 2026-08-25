import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import {
  formatBytes,
  isValidSha256,
  lanUrlsFor,
  parseRange,
  quotaDecision,
  sha256Hex,
  shardRelPath,
  timingSafeEqualHex,
  type StorageServeOptions,
  type StorageServerHandle,
  type StorageServerState,
} from "../storage-node.js";

/**
 * The real content-addressed HTTP item server — a faithful port of the serving half of
 * packages/storage-node/server.mjs (PUT/GET/HEAD/DELETE /items/<sha256> + /health), kept
 * in its own module so nothing here loads unless the storage-node capability actually
 * starts. All request DECISIONS (auth compare, quota, ranges, sharding) are the pure
 * helpers in ../storage-node.ts; this file is the streaming plumbing around them.
 *
 * Serving contract (unchanged):
 *  - Callers authenticate with the access key minted at enable time; only its sha256 hash
 *    is kept here, and the cloud hands the key only to signed-in members of the team.
 *  - Content addressing: the URL sha256 must match the bytes, verified on every write.
 */

const NODE_VERSION = "0.1.0";

const itemsRoot = (dir: string) => path.join(dir, "items");
const tmpRoot = (dir: string) => path.join(dir, "tmp");
const itemPath = (dir: string, sha: string) => path.join(itemsRoot(dir), shardRelPath(sha));
const metaPath = (dir: string, sha: string) => `${itemPath(dir, sha)}.json`;

/** Walk the sharded store once at boot: content Set + used bytes. */
async function scanStore(dir: string): Promise<StorageServerState> {
  const shas = new Set<string>();
  let usedBytes = 0;
  const root = itemsRoot(dir);
  let level1: string[];
  try {
    level1 = await readdir(root);
  } catch {
    return { shas, usedBytes };
  }
  for (const a of level1) {
    let level2: string[];
    try {
      level2 = await readdir(path.join(root, a));
    } catch {
      continue;
    }
    for (const b of level2) {
      let files: string[];
      try {
        files = await readdir(path.join(root, a, b));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!isValidSha256(file)) continue;
        try {
          const info = await stat(path.join(root, a, b, file));
          shas.add(file);
          usedBytes += info.size;
        } catch {
          /* unreadable entry: treated as absent, scrub will report it missing */
        }
      }
    }
  }
  return { shas, usedBytes };
}

async function readMeta(dir: string, sha: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(metaPath(dir, sha), "utf8")) as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function corsHeaders(): Record<string, string> {
  // Items are content-addressed and gated by the access key; the browser-based media
  // library on the hosted app origin must be able to call this LAN/funnel URL.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, range",
    "access-control-expose-headers": "content-range, accept-ranges, content-length, etag",
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string | number> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(payload);
}

function bearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function createStorageItemServer(options: {
  dir: string;
  accessKeyHash: string;
  quotaBytes: number;
  state: StorageServerState;
  name: string;
  log?: (message: string) => void;
}): http.Server {
  const { dir, accessKeyHash, quotaBytes, state, name } = options;
  const log = options.log ?? (() => {});

  async function handlePut(req: http.IncomingMessage, res: http.ServerResponse, sha: string): Promise<void> {
    if (state.shas.has(sha)) {
      // Content-addressed: same sha == same bytes. Idempotent success.
      req.resume();
      sendJson(res, 200, { sha256: sha, alreadyStored: true });
      return;
    }
    const declared = req.headers["content-length"] != null ? Number(req.headers["content-length"]) : null;
    const decision = quotaDecision({
      usedBytes: state.usedBytes,
      incomingBytes: Number.isFinite(declared) ? declared : null,
      quotaBytes,
    });
    if (!decision.allowed) {
      sendJson(res, 507, {
        error: `Disk quota exceeded: ${formatBytes(decision.remainingBytes)} of ${formatBytes(quotaBytes)} remaining.`,
      });
      req.destroy();
      return;
    }

    await mkdir(tmpRoot(dir), { recursive: true });
    const tmpFile = path.join(tmpRoot(dir), `${sha}.${randomBytes(6).toString("hex")}.part`);
    const hasher = createHash("sha256");
    let written = 0;
    const sink = createWriteStream(tmpFile, { flags: "wx" });
    try {
      await new Promise<void>((resolve, reject) => {
        req.on("data", (chunk: Buffer) => {
          written += chunk.length;
          if (written > decision.remainingBytes) {
            reject(new Error("quota"));
            return;
          }
          hasher.update(chunk);
          if (!sink.write(chunk)) req.pause();
        });
        sink.on("drain", () => req.resume());
        req.on("end", () => sink.end(resolve));
        req.on("error", reject);
        sink.on("error", reject);
      });
      const actualSha = hasher.digest("hex");
      if (actualSha !== sha) {
        await rm(tmpFile, { force: true });
        sendJson(res, 409, { error: `Content hash mismatch: body is ${actualSha}, URL says ${sha}. Nothing stored.` });
        return;
      }
      const finalPath = itemPath(dir, sha);
      await mkdir(path.dirname(finalPath), { recursive: true });
      await rename(tmpFile, finalPath);
      const contentType =
        typeof req.headers["content-type"] === "string" && req.headers["content-type"]
          ? req.headers["content-type"].slice(0, 200)
          : "application/octet-stream";
      await writeFile(
        metaPath(dir, sha),
        JSON.stringify({ contentType, byteSize: written, storedAt: new Date().toISOString() }),
      );
      state.shas.add(sha);
      state.usedBytes += written;
      sendJson(res, 201, { sha256: sha, byteSize: written, contentType });
    } catch (error) {
      await rm(tmpFile, { force: true }).catch(() => {});
      if (error instanceof Error && error.message === "quota") {
        sendJson(res, 507, { error: `Disk quota exceeded mid-upload (${formatBytes(quotaBytes)} quota). Nothing stored.` });
        req.destroy();
        return;
      }
      throw error;
    }
  }

  async function handleGet(req: http.IncomingMessage, res: http.ServerResponse, sha: string): Promise<void> {
    const file = itemPath(dir, sha);
    let info;
    try {
      info = await stat(file);
    } catch {
      sendJson(res, 404, { error: "Item is not stored on this node." });
      return;
    }
    const meta = await readMeta(dir, sha);
    const baseHeaders: Record<string, string | number> = {
      ...corsHeaders(),
      "content-type": typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream",
      "accept-ranges": "bytes",
      etag: `"${sha}"`,
      "cache-control": "private, max-age=31536000, immutable",
    };
    const range = parseRange(req.headers.range, info.size);
    if (range === "invalid") {
      res.writeHead(416, { ...baseHeaders, "content-range": `bytes */${info.size}` });
      res.end();
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...baseHeaders, "content-length": info.size });
      res.end();
      return;
    }
    if (range) {
      res.writeHead(206, {
        ...baseHeaders,
        "content-length": range.end - range.start + 1,
        "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
      });
      createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...baseHeaders, "content-length": info.size });
    createReadStream(file).pipe(res);
  }

  async function handleDelete(res: http.ServerResponse, sha: string): Promise<void> {
    const file = itemPath(dir, sha);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      sendJson(res, 404, { error: "Item is not stored on this node." });
      return;
    }
    await rm(file, { force: true });
    await rm(metaPath(dir, sha), { force: true });
    state.shas.delete(sha);
    state.usedBytes = Math.max(0, state.usedBytes - size);
    sendJson(res, 200, { deleted: sha });
  }

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (url.pathname === "/health") {
          sendJson(res, 200, { ok: true, name, version: NODE_VERSION });
          return;
        }
        const match = /^\/items\/([0-9a-f]{64})$/.exec(url.pathname);
        if (!match) {
          sendJson(res, 404, { error: "Not found. This node serves /items/<sha256> and /health." });
          return;
        }
        const sha = match[1]!;

        const key = bearerToken(req);
        if (!key || !timingSafeEqualHex(sha256Hex(key), accessKeyHash)) {
          sendJson(res, 401, { error: "Access key required. Resolve this item through your team's Vantage app." });
          return;
        }

        if (req.method === "PUT") return await handlePut(req, res, sha);
        if (req.method === "GET" || req.method === "HEAD") return await handleGet(req, res, sha);
        if (req.method === "DELETE") return await handleDelete(res, sha);
        sendJson(res, 405, { error: "Method not allowed" }, { allow: "GET, HEAD, PUT, DELETE, OPTIONS" });
      } catch (error) {
        log(`storage-node: request failed — ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) sendJson(res, 500, { error: "Storage node internal error" });
        else res.destroy();
      }
    })();
  });
}

/** Default `serve` implementation for StorageNodeCapability: scan, listen, report. */
export async function startStorageItemServer(options: StorageServeOptions): Promise<StorageServerHandle> {
  await mkdir(itemsRoot(options.dir), { recursive: true });
  await rm(tmpRoot(options.dir), { recursive: true, force: true }).catch(() => {});
  await mkdir(tmpRoot(options.dir), { recursive: true });
  const state = await scanStore(options.dir);
  const server = createStorageItemServer({
    dir: options.dir,
    accessKeyHash: options.accessKeyHash,
    quotaBytes: options.quotaBytes,
    state,
    name: options.name,
    log: options.log,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => resolve());
  });
  return {
    port: options.port,
    state,
    lanUrls: lanUrlsFor(networkInterfaces() as never, options.port),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Do not wait on open keep-alive sockets forever.
        server.closeAllConnections?.();
      }),
  };
}

/**
 * Mint a new storage access key on THIS machine (mirrors storage-node/server.mjs setup):
 * the plaintext goes to the cloud once over HTTPS so it can be handed to signed-in team
 * members; only its sha256 hash is kept in the connector config.
 */
export function generateStorageAccessKey(): { accessKey: string; accessKeyHash: string } {
  const accessKey = randomBytes(32).toString("base64url");
  return { accessKey, accessKeyHash: sha256Hex(accessKey) };
}
