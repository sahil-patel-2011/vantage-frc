#!/usr/bin/env node
/** Legacy archive access only. New photo/video storage and pairing are retired.
 * Existing items and partial uploads are preserved; reads and explicit deletion remain authenticated. */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NODE_VERSION = "0.2.0";
export const DEFAULT_PORT = 8788;
export const DEFAULT_QUOTA_GB = 20;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const SHA256_RE = /^[0-9a-f]{64}$/;
/** Same unambiguous alphabet the cloud uses for pairing codes (no I/O/0/1). */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Abandoned chunked uploads are garbage-collected after this long. */
export const STALE_UPLOAD_MS = 7 * 24 * 60 * 60 * 1000;
export const GRANT_TOKEN_PREFIX = "sg1";

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function isValidSha256(value) {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** Content-addressed on-disk layout: ab/cd/abcdef… keeps directories small on a Pi's SD card. */
export function shardRelPath(sha256) {
  if (!isValidSha256(sha256)) throw new Error("shardRelPath requires a lowercase hex sha256");
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Constant-time comparison of two hex digests (token auth must not leak timing). */
export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Normalize a human pairing code: strip separators/whitespace, uppercase, validate against the
 * unambiguous alphabet. Returns the bare 8-char code or null.
 */
export function normalizePairingCode(raw) {
  if (typeof raw !== "string") return null;
  const bare = raw.replace(/[\s-]/g, "").toUpperCase();
  if (bare.length !== 8) return null;
  for (const ch of bare) if (!PAIRING_CODE_ALPHABET.includes(ch)) return null;
  return bare;
}

/**
 * Parse an HTTP Range header for a resource of `size` bytes.
 * Returns null when absent/unsupported (serve 200 full), the string "invalid" when
 * unsatisfiable (respond 416), or { start, end } inclusive for a single satisfiable range.
 * Multi-range requests are deliberately unsupported -> null (full response is always correct).
 */
export function parseRange(header, size) {
  if (header == null || header === "") return null;
  if (typeof header !== "string" || !Number.isInteger(size) || size < 0) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // malformed or multi-range: ignore per RFC 9110, serve full
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;
  if (startRaw === "") {
    // suffix range: last N bytes
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix === 0 || size === 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start >= size) return "invalid";
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(end) || end < start) return "invalid";
  return { start, end };
}

/**
 * Disk-quota decision for an incoming write. `incomingBytes` may be null (unknown length:
 * allowed to start, but the stream is aborted the moment it would cross the remaining budget).
 */
export function quotaDecision({ usedBytes, incomingBytes, quotaBytes }) {
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  if (incomingBytes == null) return { allowed: remainingBytes > 0, remainingBytes };
  return { allowed: incomingBytes <= remainingBytes, remainingBytes };
}

/**
 * Incremental scrub: given the shas the cloud asked us to verify and a Set of shas actually on
 * disk, split into verified/missing. Pure so the honesty path is testable.
 */
export function computeScrubReport(pendingShas, onDisk) {
  const verified = [];
  const missing = [];
  for (const sha of Array.isArray(pendingShas) ? pendingShas : []) {
    if (!isValidSha256(sha)) continue;
    (onDisk.has(sha) ? verified : missing).push(sha);
  }
  return { verified, missing };
}

/**
 * CORS origin resolution: reflect the request Origin ONLY when it is on the allowlist.
 * Returns the origin string to echo, or null (no CORS headers -> browser blocks cross-origin
 * use; non-browser clients are unaffected). Never returns "*".
 */
export function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (typeof requestOrigin !== "string" || !requestOrigin) return null;
  if (!Array.isArray(allowedOrigins)) return null;
  let normalized;
  try {
    normalized = new URL(requestOrigin).origin;
  } catch {
    return null;
  }
  for (const allowed of allowedOrigins) {
    if (typeof allowed !== "string") continue;
    try {
      if (new URL(allowed).origin === normalized) return normalized;
    } catch {
      /* skip malformed allowlist entries */
    }
  }
  return null;
}

// ---- upload/download grants (format mirrored in apps/web/lib/storage-routing/grants.ts) ----

/** Deterministic serialization: fixed key order, no whitespace. */
export function canonicalGrantPayload(payload) {
  return JSON.stringify({
    v: payload.v,
    op: payload.op,
    org: payload.org,
    sha256: payload.sha256,
    maxBytes: payload.maxBytes,
    nonce: payload.nonce,
    exp: payload.exp,
  });
}

function signGrant(body, keyHex) {
  return createHmac("sha256", Buffer.from(keyHex, "utf8")).update(body, "utf8").digest("hex");
}

/** Mint a grant token (used by the cloud; exported here for tests + interop pinning). */
export function mintGrantToken(payload, signingKey) {
  const body = `${GRANT_TOKEN_PREFIX}.${Buffer.from(canonicalGrantPayload(payload), "utf8").toString("base64url")}`;
  return `${body}.${signGrant(body, signingKey)}`;
}

/**
 * Verify a grant token offline. `signingKey` is this node's access-key hash (config
 * accessKeyHash — present since pairing, no re-pair needed). Checks signature, version,
 * operation, org, sha256, expiry, and byte budget. Single-use (nonce) is enforced by the
 * caller against consumedNonces, because "use" means a COMPLETED upload, not an attempt.
 */
export function verifyGrantToken(token, { signingKey, org, sha256, op, nowMs }) {
  if (typeof token !== "string") return { ok: false, reason: "missing token" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== GRANT_TOKEN_PREFIX) return { ok: false, reason: "malformed token" };
  const body = `${parts[0]}.${parts[1]}`;
  if (!timingSafeEqualHex(parts[2], signGrant(body, signingKey))) return { ok: false, reason: "bad signature" };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }
  if (payload.v !== 1) return { ok: false, reason: "unsupported grant version" };
  if (payload.op !== op) return { ok: false, reason: `grant does not authorize ${op}` };
  if (payload.org !== org) return { ok: false, reason: "grant is for a different organization" };
  if (payload.sha256 !== sha256) return { ok: false, reason: "grant is for a different item" };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= nowMs) return { ok: false, reason: "grant expired" };
  if (!Number.isFinite(payload.maxBytes) || payload.maxBytes < 1) return { ok: false, reason: "grant has no byte budget" };
  return { ok: true, payload };
}

/** Interactive-free CLI flags. Unknown flags throw so typos never silently misconfigure a node. */
export function parseArgs(argv) {
  const out = {
    setup: false,
    cloud: null,
    name: null,
    dir: null,
    port: DEFAULT_PORT,
    quotaGb: null,
    allowOrigins: [],
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      i += 1;
      return value;
    };
    if (flag === "--setup") out.setup = true;
    else if (flag === "--help" || flag === "-h") out.help = true;
    else if (flag === "--cloud") out.cloud = next().replace(/\/+$/, "");
    else if (flag === "--name") out.name = next().slice(0, 100);
    else if (flag === "--dir") out.dir = next();
    else if (flag === "--allow-origin") out.allowOrigins.push(next().replace(/\/+$/, ""));
    else if (flag === "--port") {
      const port = Number(next());
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be 1-65535");
      out.port = port;
    } else if (flag === "--quota-gb") {
      const gb = Number(next());
      if (!Number.isFinite(gb) || gb <= 0) throw new Error("--quota-gb must be a positive number");
      out.quotaGb = gb;
    } else throw new Error(`Unknown flag: ${flag} (see --help)`);
  }
  return out;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Private LAN URLs (real interfaces only) reported to the cloud as same-network hints. */
export function lanUrlsFor(interfaces, port) {
  const urls = [];
  for (const addrs of Object.values(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Config + store layout
// ---------------------------------------------------------------------------

const defaultDataDir = () => process.env.VANTAGE_STORAGE_DIR || path.join(process.cwd(), "vantage-storage");
const configPath = (dir) => path.join(dir, "config.json");
const itemsRoot = (dir) => path.join(dir, "items");
const metaPath = (dir, sha) => path.join(itemsRoot(dir), `${shardRelPath(sha)}.json`);
const itemPath = (dir, sha) => path.join(itemsRoot(dir), shardRelPath(sha));

async function loadConfig(dir) {
  try {
    const raw = JSON.parse(await readFile(configPath(dir), "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

async function scanStore(dir) {
  const shas = new Set();
  let usedBytes = 0;
  const root = itemsRoot(dir);
  let level1;
  try {
    level1 = await readdir(root);
  } catch {
    return { shas, usedBytes };
  }
  for (const a of level1) {
    let level2;
    try {
      level2 = await readdir(path.join(root, a));
    } catch {
      continue;
    }
    for (const b of level2) {
      let files;
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

async function readMeta(dir, sha) {
  try {
    const raw = JSON.parse(await readFile(metaPath(dir, sha), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Drop chunked-upload leftovers no one has touched for STALE_UPLOAD_MS. */
function corsHeadersFor(origin) {
  if (!origin) return { vary: "origin" };
  return {
    vary: "origin",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, range, upload-offset, x-upload-length, x-upload-content-type",
    "access-control-expose-headers": "content-range, accept-ranges, content-length, etag, upload-offset, upload-length",
  };
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function createItemServer({ dir, accessKeyHash, state, name, orgId = null, allowedOrigins = [], log = console.error, now = () => Date.now() }) {
  return http.createServer(async (req, res) => {
    const cors = corsHeadersFor(resolveCorsOrigin(req.headers.origin, allowedOrigins));
    const reply = (status, body, extra = {}) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...cors, ...extra });
      res.end(payload);
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      if (["PUT", "POST", "PATCH"].includes(req.method) || url.pathname.startsWith("/uploads/")) {
        req.resume();
        reply(410, { error: "Photo/video uploads and storage setup are no longer supported." });
        return;
      }
      if (url.pathname === "/health" && req.method === "GET") { reply(200, { ok: true, name, version: NODE_VERSION, archiveOnly: true }); return; }
      const match = /^\/items\/([0-9a-f]{64})$/.exec(url.pathname);
      if (!match) { reply(404, { error: "Not found." }); return; }
      const sha = match[1];
      const token = bearerToken(req) ?? (req.method === "GET" || req.method === "HEAD" ? url.searchParams.get("grant") : null);
      const master = token && timingSafeEqualHex(sha256Hex(token), accessKeyHash);
      const grant = token?.startsWith(`${GRANT_TOKEN_PREFIX}.`) && ["GET", "HEAD"].includes(req.method)
        ? verifyGrantToken(token, { signingKey: accessKeyHash, org: orgId ?? "", sha256: sha, op: "get", nowMs: now() }) : null;
      if (!master && !grant?.ok) { reply(401, { error: "Valid archive access key or download grant required." }); return; }
      if (!["GET", "HEAD", "DELETE"].includes(req.method)) { reply(405, { error: "Method not allowed" }, { allow: "GET, HEAD, DELETE, OPTIONS" }); return; }
      const file = itemPath(dir, sha);
      let info;
      try { info = await stat(file); } catch { reply(404, { error: "Item is not stored on this node." }); return; }
      if (req.method === "DELETE") {
        await rm(file, { force: true });
        await rm(metaPath(dir, sha), { force: true });
        state.shas.delete(sha);
        state.usedBytes = Math.max(0, state.usedBytes - info.size);
        reply(200, { deleted: sha });
        return;
      }
      const meta = await readMeta(dir, sha);
      const headers = { ...cors, "content-type": typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream",
        "accept-ranges": "bytes", etag: `"${sha}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
      const range = parseRange(req.headers.range, info.size);
      if (range === "invalid") { res.writeHead(416, { ...headers, "content-range": `bytes */${info.size}` }); res.end(); return; }
      if (req.method === "HEAD") { res.writeHead(200, { ...headers, "content-length": info.size }); res.end(); return; }
      if (range) res.writeHead(206, { ...headers, "content-length": range.end - range.start + 1, "content-range": `bytes ${range.start}-${range.end}/${info.size}` });
      else res.writeHead(200, { ...headers, "content-length": info.size });
      const stream = createReadStream(file, range ? { start: range.start, end: range.end } : undefined);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      log(`storage-node: archive request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) reply(500, { error: "Archive access failed" }); else res.destroy();
    }
  });
}
const HELP = `Vantage legacy archive: new storage setup and uploads are retired.
Read existing items: node server.mjs [--dir DIR] [--port 8788] [--allow-origin URL]`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.setup) {
    throw new Error("Photo/video storage setup is no longer supported.");
  }

  const dir = args.dir ?? defaultDataDir();
  const config = await loadConfig(dir);
  if (!config?.accessKeyHash) {
    throw new Error(`No existing archive access configuration at ${configPath(dir)}. New storage setup is retired.`);
  }
  const port = args.port !== DEFAULT_PORT ? args.port : (config.port ?? DEFAULT_PORT);
  const quotaBytes = args.quotaGb != null ? Math.round(args.quotaGb * 1024 ** 3) : (config.quotaBytes ?? DEFAULT_QUOTA_GB * 1024 ** 3);

  // CORS allowlist: the paired cloud origin always; config + flags extend it. Never "*".
  let cloudOrigin = null;
  try {
    cloudOrigin = new URL(config.cloudUrl).origin;
  } catch {
    /* config.cloudUrl malformed — no origin derived */
  }
  const allowedOrigins = [...new Set([
    ...(cloudOrigin ? [cloudOrigin] : []),
    ...(Array.isArray(config.allowedOrigins) ? config.allowedOrigins : []),
    ...args.allowOrigins,
  ])];

  const state = await scanStore(dir);
  console.error(
    `storage-node ${NODE_VERSION}: ${state.shas.size} archived item(s), ${formatBytes(state.usedBytes)} stored, data in ${dir}`,
  );

  const server = createItemServer({
    dir,
    accessKeyHash: config.accessKeyHash,
    quotaBytes,
    state,
    name: config.name ?? "storage-node",
    orgId: config.orgId ?? null,
    allowedOrigins,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  console.error(`storage-node: serving http://0.0.0.0:${port} (LAN: ${lanUrlsFor(networkInterfaces(), port).join(", ") || "no external interface found"})`);
  console.error(`storage-node: browser origins allowed by CORS: ${allowedOrigins.join(", ") || "none"}`);
  console.error("storage-node: existing archives require a reachable address and their existing access credentials.");
  console.error("storage-node: archive access only; uploads, setup and background media workers are retired.");
}

const isMain = (() => {
  try {
    return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    console.error(`storage-node: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
