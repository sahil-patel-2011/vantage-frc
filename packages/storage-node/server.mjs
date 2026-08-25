#!/usr/bin/env node
/**
 * Vantage self-hosted storage node.
 *
 * A single-file, stdlib-only Node.js service (Node 20+) a team runs on a Raspberry Pi, shop PC,
 * or NAS (Docker images ship next to this file) to extend their Vantage storage: large binary
 * items live here, only metadata lives in the hosted database. Full guide: docs/STORAGE_NODE.md
 * and docs/NAS_HOSTING.md in the Vantage repo.
 *
 *   Pair once :  node server.mjs --setup --cloud https://your-vantage-host [--name pi-shop]
 *   Run       :  node server.mjs [--dir /var/lib/vantage-storage] [--port 8788] [--quota-gb 20]
 *
 * Architecture (mirrors the Vantage CAD relay pairing):
 *   - Pairing: this node asks the cloud for an 8-char human code; a team owner/admin enters it
 *     at /team/storage. The cloud issues a node token (it stores only the sha256 hash).
 *   - Every heartbeat (60s) authenticates with that token and reports REAL disk stats plus an
 *     incremental scrub of items the cloud believes are stored here (stored|missing honesty).
 *   - Serving: PUT/GET/HEAD/DELETE /items/<sha256> plus a resumable chunked protocol under
 *     /uploads/<sha256> for very large files. Two credentials are accepted:
 *       1. the node's master access key (generated on this machine at setup; only its sha256
 *          hash is kept here) — full read/write, handed by the cloud to signed-in team members;
 *       2. a short-lived, single-use, HMAC-signed GRANT the cloud mints per upload/download,
 *          scoped to one org + one sha256 + a byte ceiling. The signing key is this node's
 *          access-key hash, so grants verify OFFLINE — no cloud round trip — and the browser
 *          never needs the master key. Format mirrored in apps/web/lib/storage-routing/grants.ts.
 *   - Content addressing: the URL sha256 must match the bytes, verified on every write (both
 *     one-shot and chunked); a mismatch stores nothing.
 *   - CORS: only the paired cloud origin (plus any --allow-origin extras) is allowed — never *.
 *
 * Networking truth: on your LAN this node serves the shop/pit directly. From anywhere else it
 * is only reachable if you give it a public URL (Cloudflare Tunnel or Tailscale) and paste
 * that URL into /team/storage. The cloud cannot magically reach a NATed device — and a browser
 * on the https app cannot call a plain-http LAN address (mixed content), so in practice you
 * want an https URL even for shop use. docs/NAS_HOSTING.md walks through both options.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, statfs, truncate, writeFile } from "node:fs/promises";
import http from "node:http";
import { hostname, networkInterfaces } from "node:os";
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
const tmpRoot = (dir) => path.join(dir, "tmp");
const uploadsRoot = (dir) => path.join(dir, "uploads");
const metaPath = (dir, sha) => path.join(itemsRoot(dir), `${shardRelPath(sha)}.json`);
const itemPath = (dir, sha) => path.join(itemsRoot(dir), shardRelPath(sha));
const uploadPartPath = (dir, sha) => path.join(uploadsRoot(dir), `${sha}.part`);
const uploadStatePath = (dir, sha) => path.join(uploadsRoot(dir), `${sha}.json`);

async function loadConfig(dir) {
  try {
    const raw = JSON.parse(await readFile(configPath(dir), "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

async function saveConfig(dir, config) {
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(dir), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(configPath(dir), 0o600).catch(() => {});
}

/** Walk the sharded store once at boot: content Set + used bytes. */
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
async function gcStaleUploads(dir, log) {
  let entries;
  try {
    entries = await readdir(uploadsRoot(dir));
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  for (const entry of entries) {
    const full = path.join(uploadsRoot(dir), entry);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await rm(full, { force: true });
        log?.(`storage-node: cleaned up stale upload ${entry}`);
      }
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Pairing (--setup)
// ---------------------------------------------------------------------------

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  return { ok: response.ok, status: response.status, data };
}

async function runSetup(args) {
  if (!args.cloud) throw new Error("--setup requires --cloud https://your-vantage-host");
  const dir = args.dir ?? defaultDataDir();
  const name = args.name || hostname().slice(0, 100) || "storage-node";
  // Access key: generated HERE; only its hash stays on this machine. The plaintext goes to the
  // cloud once (over HTTPS) so it can be handed to signed-in team members, mirroring how the
  // CAD pairing flow transports the device token. The hash doubles as the signing key for
  // offline-verified upload/download grants.
  const accessKey = randomBytes(32).toString("base64url");

  const start = await postJson(`${args.cloud}/api/storage-node/pair/start`, {
    machineName: name,
    nodeVersion: NODE_VERSION,
    accessKey,
  });
  if (!start.ok) throw new Error(start.data.error || `Pairing could not start (HTTP ${start.status})`);
  const { userCode, pollToken, verificationUri, interval, expiresIn } = start.data;

  console.log("");
  console.log(`  Pairing code:  ${userCode}`);
  console.log(`  Ask a team owner/admin to open ${verificationUri || `${args.cloud}/team/storage`}`);
  console.log(`  and enter the code. It expires in ${Math.round((expiresIn ?? 600) / 60)} minutes.`);
  console.log("");

  const deadline = Date.now() + (expiresIn ?? 600) * 1000;
  const waitMs = Math.max(2, interval ?? 3) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const poll = await postJson(`${args.cloud}/api/storage-node/pair/poll`, { pollToken });
    if (poll.data.status === "pending") continue;
    if (poll.data.status === "approved") {
      let cloudOrigin = args.cloud;
      try {
        cloudOrigin = new URL(args.cloud).origin;
      } catch {
        /* keep as-is */
      }
      await saveConfig(dir, {
        cloudUrl: args.cloud,
        nodeToken: poll.data.nodeToken,
        nodeId: poll.data.nodeId,
        orgId: poll.data.orgId,
        name,
        accessKeyHash: sha256Hex(accessKey),
        quotaBytes: Math.round((args.quotaGb ?? DEFAULT_QUOTA_GB) * 1024 ** 3),
        port: args.port,
        // CORS allowlist: exactly the cloud origin by default; --allow-origin extends at runtime.
        allowedOrigins: [cloudOrigin],
      });
      console.log(`Paired. Config saved to ${configPath(dir)} (contains this node's token — keep it private).`);
      console.log(`Start serving with:  node server.mjs --dir ${dir}`);
      return;
    }
    throw new Error(poll.data.error || `Pairing ${poll.data.status || "failed"} — run --setup again`);
  }
  throw new Error("Pairing code expired before it was approved. Run --setup again.");
}

// ---------------------------------------------------------------------------
// HTTP item server
// ---------------------------------------------------------------------------

function corsHeadersFor(origin) {
  if (!origin) return { vary: "origin" };
  return {
    vary: "origin",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
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

export function createItemServer({
  dir,
  accessKeyHash,
  quotaBytes,
  state,
  name,
  orgId = null,
  allowedOrigins = [],
  log = console.error,
  now = () => Date.now(),
}) {
  // Single-use enforcement: nonces of grants whose upload COMPLETED. In-memory on purpose —
  // expiry (minutes) bounds replay across restarts, and a replayed completed upload is
  // content-addressed anyway (idempotent alreadyStored), so nothing dishonest can happen.
  const consumedNonces = new Map(); // nonce -> expMs
  // In-flight chunked-upload sessions: sha -> { hasher, hashedBytes }. Rebuilt from the
  // partial file after a restart.
  const uploadSessions = new Map();
  const activeShas = new Set();

  function pruneNonces() {
    const nowMs = now();
    for (const [nonce, expMs] of consumedNonces) {
      if (expMs <= nowMs) consumedNonces.delete(nonce);
    }
  }

  function consumeNonce(grant) {
    if (!grant) return;
    pruneNonces();
    consumedNonces.set(grant.nonce, grant.exp * 1000);
  }

  /**
   * Authenticate a request for `sha` and operation `op` ("upload" | "get" | "delete").
   * Returns { ok:true, grant: payload|null } (grant null = master access key) or
   * { ok:false, status, reason }.
   */
  function authenticate(req, url, sha, op) {
    const bearer = bearerToken(req);
    const queryGrant = url.searchParams.get("grant");
    const token = bearer ?? ((op === "get" && queryGrant) ? queryGrant : null);
    if (!token) {
      return { ok: false, status: 401, reason: "Access key or grant required. Resolve this item through your team's Vantage app." };
    }
    if (!token.startsWith(`${GRANT_TOKEN_PREFIX}.`)) {
      if (timingSafeEqualHex(sha256Hex(token), accessKeyHash)) return { ok: true, grant: null };
      return { ok: false, status: 401, reason: "Access key is not valid for this node." };
    }
    if (op === "delete") {
      return { ok: false, status: 403, reason: "Grants cannot delete items — deletes need the node's access key." };
    }
    const verified = verifyGrantToken(token, {
      signingKey: accessKeyHash,
      org: orgId ?? "",
      sha256: sha,
      op: op === "get" ? "get" : "upload",
      nowMs: now(),
    });
    if (!verified.ok) return { ok: false, status: 403, reason: `Grant rejected: ${verified.reason}.` };
    pruneNonces();
    if (op !== "get" && consumedNonces.has(verified.payload.nonce)) {
      return { ok: false, status: 403, reason: "Grant rejected: already used. Request a fresh grant from the app." };
    }
    return { ok: true, grant: verified.payload };
  }

  return http.createServer(async (req, res) => {
    const cors = corsHeadersFor(resolveCorsOrigin(req.headers.origin, allowedOrigins));
    const reply = (status, body, extraHeaders = {}) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...cors,
        ...extraHeaders,
      });
      res.end(payload);
    };

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (url.pathname === "/health") {
        reply(200, { ok: true, name, version: NODE_VERSION });
        return;
      }

      const itemMatch = /^\/items\/([0-9a-f]{64})$/.exec(url.pathname);
      const uploadMatch = /^\/uploads\/([0-9a-f]{64})$/.exec(url.pathname);
      if (!itemMatch && !uploadMatch) {
        reply(404, { error: "Not found. This node serves /items/<sha256>, /uploads/<sha256>, and /health." });
        return;
      }
      const sha = (itemMatch ?? uploadMatch)[1];

      if (itemMatch) {
        const opFor = req.method === "PUT" ? "upload" : req.method === "DELETE" ? "delete" : "get";
        const auth = authenticate(req, url, sha, opFor);
        if (!auth.ok) {
          reply(auth.status, { error: auth.reason });
          return;
        }
        if (req.method === "PUT") return await handlePut(req, sha, auth.grant);
        if (req.method === "GET" || req.method === "HEAD") return await handleGet(req, sha);
        if (req.method === "DELETE") return await handleDelete(sha);
        reply(405, { error: "Method not allowed" }, { allow: "GET, HEAD, PUT, DELETE, OPTIONS" });
        return;
      }

      // /uploads/<sha> — resumable chunked protocol.
      const auth = authenticate(req, url, sha, "upload");
      if (!auth.ok) {
        reply(auth.status, { error: auth.reason });
        return;
      }
      if (req.method === "POST") return await handleUploadStart(req, sha, auth.grant);
      if (req.method === "HEAD") return await handleUploadStatus(sha);
      if (req.method === "PATCH") return await handleUploadChunk(req, sha, auth.grant);
      if (req.method === "DELETE") return await handleUploadAbort(sha);
      reply(405, { error: "Method not allowed" }, { allow: "POST, HEAD, PATCH, DELETE, OPTIONS" });
      return;

      // ---- handlers (closures over req/res/reply) ----

      async function handlePut(req, sha, grant) {
        if (state.shas.has(sha)) {
          // Content-addressed: same sha == same bytes. Idempotent success.
          req.resume();
          consumeNonce(grant);
          reply(200, { sha256: sha, alreadyStored: true });
          return;
        }
        const declared = req.headers["content-length"] != null ? Number(req.headers["content-length"]) : null;
        if (grant && Number.isFinite(declared) && declared > grant.maxBytes) {
          reply(413, { error: `Upload is ${formatBytes(declared)} but the grant allows at most ${formatBytes(grant.maxBytes)}.` });
          req.destroy();
          return;
        }
        const decision = quotaDecision({
          usedBytes: state.usedBytes,
          incomingBytes: Number.isFinite(declared) ? declared : null,
          quotaBytes,
        });
        if (!decision.allowed) {
          reply(507, {
            error: `Disk quota exceeded: ${formatBytes(decision.remainingBytes)} of ${formatBytes(quotaBytes)} remaining.`,
          });
          req.destroy();
          return;
        }

        await mkdir(tmpRoot(dir), { recursive: true });
        const tmpFile = path.join(tmpRoot(dir), `${sha}.${randomBytes(6).toString("hex")}.part`);
        const hasher = createHash("sha256");
        let written = 0;
        const byteCeiling = Math.min(decision.remainingBytes, grant ? grant.maxBytes : Infinity);
        const sink = createWriteStream(tmpFile, { flags: "wx" });
        try {
          await new Promise((resolve, reject) => {
            req.on("data", (chunk) => {
              written += chunk.length;
              if (written > byteCeiling) {
                reject(new Error(written > decision.remainingBytes ? "quota" : "grant-bytes"));
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
            reply(409, { error: `Content hash mismatch: body is ${actualSha}, URL says ${sha}. Nothing stored.` });
            return;
          }
          const finalPath = itemPath(dir, sha);
          await mkdir(path.dirname(finalPath), { recursive: true });
          await rename(tmpFile, finalPath);
          const contentType =
            typeof req.headers["content-type"] === "string" && req.headers["content-type"]
              ? req.headers["content-type"].slice(0, 200)
              : "application/octet-stream";
          await writeFile(metaPath(dir, sha), JSON.stringify({ contentType, byteSize: written, storedAt: new Date().toISOString() }));
          state.shas.add(sha);
          state.usedBytes += written;
          consumeNonce(grant);
          reply(201, { sha256: sha, byteSize: written, contentType });
        } catch (error) {
          await rm(tmpFile, { force: true }).catch(() => {});
          if (error instanceof Error && error.message === "quota") {
            reply(507, { error: `Disk quota exceeded mid-upload (${formatBytes(quotaBytes)} quota). Nothing stored.` });
            req.destroy();
            return;
          }
          if (error instanceof Error && error.message === "grant-bytes") {
            reply(413, { error: `Upload exceeded the grant's ${formatBytes(grant?.maxBytes ?? 0)} budget. Nothing stored.` });
            req.destroy();
            return;
          }
          throw error;
        }
      }

      async function handleGet(req, sha) {
        const file = itemPath(dir, sha);
        let info;
        try {
          info = await stat(file);
        } catch {
          reply(404, { error: "Item is not stored on this node." });
          return;
        }
        const meta = await readMeta(dir, sha);
        const baseHeaders = {
          ...cors,
          "content-type": typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream",
          "accept-ranges": "bytes",
          etag: `"${sha}"`,
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
          // Anything active (HTML, SVG) must never execute from this origin.
          "content-security-policy": "default-src 'none'; sandbox",
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

      async function handleDelete(sha) {
        const file = itemPath(dir, sha);
        let size;
        try {
          size = (await stat(file)).size;
        } catch {
          reply(404, { error: "Item is not stored on this node." });
          return;
        }
        await rm(file, { force: true });
        await rm(metaPath(dir, sha), { force: true });
        state.shas.delete(sha);
        state.usedBytes = Math.max(0, state.usedBytes - size);
        reply(200, { deleted: sha });
      }

      // ---- chunked/resumable uploads ----

      async function partSize(sha) {
        try {
          return (await stat(uploadPartPath(dir, sha))).size;
        } catch {
          return null;
        }
      }

      async function readUploadState(sha) {
        try {
          const raw = JSON.parse(await readFile(uploadStatePath(dir, sha), "utf8"));
          return raw && typeof raw === "object" ? raw : null;
        } catch {
          return null;
        }
      }

      /** Rebuild the running hash after a restart by re-reading the partial file. */
      async function sessionFor(sha, offset) {
        const existing = uploadSessions.get(sha);
        if (existing && existing.hashedBytes === offset) return existing;
        const hasher = createHash("sha256");
        if (offset > 0) {
          await new Promise((resolve, reject) => {
            const stream = createReadStream(uploadPartPath(dir, sha), { end: offset - 1 });
            stream.on("data", (chunk) => hasher.update(chunk));
            stream.on("end", resolve);
            stream.on("error", reject);
          });
        }
        const session = { hasher, hashedBytes: offset };
        uploadSessions.set(sha, session);
        return session;
      }

      async function handleUploadStart(req, sha, grant) {
        req.resume();
        if (state.shas.has(sha)) {
          consumeNonce(grant);
          reply(200, { sha256: sha, alreadyStored: true, offset: null });
          return;
        }
        const totalBytes = Number(req.headers["x-upload-length"]);
        if (!Number.isInteger(totalBytes) || totalBytes < 1) {
          reply(400, { error: "x-upload-length header (total file bytes) is required." });
          return;
        }
        if (grant && totalBytes > grant.maxBytes) {
          reply(413, { error: `Upload is ${formatBytes(totalBytes)} but the grant allows at most ${formatBytes(grant.maxBytes)}.` });
          return;
        }
        const existingState = await readUploadState(sha);
        const existingOffset = (await partSize(sha)) ?? 0;
        if (existingState && Number(existingState.totalBytes) !== totalBytes) {
          // Same sha, different declared length: the earlier declaration was wrong. Start over.
          await rm(uploadPartPath(dir, sha), { force: true });
          await rm(uploadStatePath(dir, sha), { force: true });
          uploadSessions.delete(sha);
        }
        const offset = existingState && Number(existingState.totalBytes) === totalBytes ? existingOffset : 0;
        const remainingNeeded = totalBytes - offset;
        const decision = quotaDecision({ usedBytes: state.usedBytes, incomingBytes: remainingNeeded, quotaBytes });
        if (!decision.allowed) {
          reply(507, {
            error: `Disk quota exceeded: ${formatBytes(decision.remainingBytes)} of ${formatBytes(quotaBytes)} remaining, ${formatBytes(remainingNeeded)} still needed.`,
          });
          return;
        }
        const contentType =
          (typeof req.headers["x-upload-content-type"] === "string" && req.headers["x-upload-content-type"].slice(0, 200)) ||
          (existingState && typeof existingState.contentType === "string" ? existingState.contentType : "application/octet-stream");
        await mkdir(uploadsRoot(dir), { recursive: true });
        await writeFile(uploadStatePath(dir, sha), JSON.stringify({ totalBytes, contentType, updatedAt: new Date().toISOString() }));
        if (offset === 0) await writeFile(uploadPartPath(dir, sha), Buffer.alloc(0));
        reply(offset === 0 ? 201 : 200, { sha256: sha, alreadyStored: false, offset, totalBytes }, { "upload-offset": String(offset), "upload-length": String(totalBytes) });
      }

      async function handleUploadStatus(sha) {
        if (state.shas.has(sha)) {
          let size = 0;
          try {
            size = (await stat(itemPath(dir, sha))).size;
          } catch {
            /* stored set said yes; treat as size 0 rather than fail a HEAD */
          }
          res.writeHead(200, { ...cors, "upload-offset": String(size), "upload-length": String(size), "x-upload-complete": "1" });
          res.end();
          return;
        }
        const uploadState = await readUploadState(sha);
        const offset = await partSize(sha);
        if (!uploadState || offset == null) {
          res.writeHead(404, cors);
          res.end();
          return;
        }
        res.writeHead(200, {
          ...cors,
          "upload-offset": String(offset),
          "upload-length": String(Number(uploadState.totalBytes) || 0),
        });
        res.end();
      }

      async function handleUploadChunk(req, sha, grant) {
        if (state.shas.has(sha)) {
          req.resume();
          consumeNonce(grant);
          reply(200, { sha256: sha, alreadyStored: true });
          return;
        }
        if (activeShas.has(sha)) {
          req.resume();
          reply(409, { error: "Another chunk for this item is already in flight. Retry in a moment." });
          return;
        }
        const uploadState = await readUploadState(sha);
        const currentOffset = await partSize(sha);
        if (!uploadState || currentOffset == null) {
          req.resume();
          reply(404, { error: "No chunked upload session for this item. POST /uploads/<sha256> first." });
          return;
        }
        const totalBytes = Number(uploadState.totalBytes);
        const declaredOffset = Number(req.headers["upload-offset"]);
        if (!Number.isInteger(declaredOffset) || declaredOffset < 0) {
          req.resume();
          reply(400, { error: "upload-offset header is required." }, { "upload-offset": String(currentOffset) });
          return;
        }
        if (declaredOffset !== currentOffset) {
          // Resume contract: the client asks HEAD (or reads this response) and continues
          // from the offset the node actually has. Nothing is overwritten or duplicated.
          req.resume();
          reply(409, { error: `Offset mismatch: node has ${currentOffset} bytes, chunk starts at ${declaredOffset}.`, offset: currentOffset }, { "upload-offset": String(currentOffset) });
          return;
        }
        if (grant && totalBytes > grant.maxBytes) {
          req.resume();
          reply(413, { error: `Upload is ${formatBytes(totalBytes)} but the grant allows at most ${formatBytes(grant.maxBytes)}.` });
          return;
        }

        activeShas.add(sha);
        try {
          const session = await sessionFor(sha, currentOffset);
          const remainingQuota = Math.max(0, quotaBytes - state.usedBytes);
          const byteCeiling = Math.min(totalBytes - currentOffset, remainingQuota);
          let written = 0;
          const hasher = session.hasher;
          const sink = createWriteStream(uploadPartPath(dir, sha), { flags: "a" });
          try {
            await new Promise((resolve, reject) => {
              req.on("data", (chunk) => {
                written += chunk.length;
                if (written > byteCeiling) {
                  reject(new Error(currentOffset + written > totalBytes ? "overrun" : "quota"));
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
          } catch (error) {
            sink.destroy();
            // Drop the in-memory session so the next chunk re-hashes from disk — the offset
            // check plus rehash keeps the byte stream and its hash consistent after any tear.
            uploadSessions.delete(sha);
            if (error instanceof Error && (error.message === "quota" || error.message === "overrun")) {
              // Trim the part file back to the declared offset (constant memory).
              await truncate(uploadPartPath(dir, sha), currentOffset).catch(() => {});
              reply(
                error.message === "quota" ? 507 : 400,
                {
                  error:
                    error.message === "quota"
                      ? `Disk quota exceeded mid-upload (${formatBytes(quotaBytes)} quota).`
                      : `Chunk overran the declared total of ${formatBytes(totalBytes)}.`,
                },
                { "upload-offset": String(currentOffset) },
              );
              req.destroy();
              return;
            }
            throw error;
          }
          session.hashedBytes = currentOffset + written;

          if (session.hashedBytes < totalBytes) {
            reply(200, { sha256: sha, offset: session.hashedBytes, totalBytes }, { "upload-offset": String(session.hashedBytes) });
            return;
          }

          // Final chunk: verify the whole stream against the content address.
          const actualSha = hasher.digest("hex");
          uploadSessions.delete(sha);
          if (actualSha !== sha) {
            await rm(uploadPartPath(dir, sha), { force: true });
            await rm(uploadStatePath(dir, sha), { force: true });
            reply(409, { error: `Content hash mismatch: body is ${actualSha}, URL says ${sha}. Nothing stored.` });
            return;
          }
          const finalPath = itemPath(dir, sha);
          await mkdir(path.dirname(finalPath), { recursive: true });
          await rename(uploadPartPath(dir, sha), finalPath);
          await rm(uploadStatePath(dir, sha), { force: true });
          const contentType = typeof uploadState.contentType === "string" ? uploadState.contentType : "application/octet-stream";
          await writeFile(metaPath(dir, sha), JSON.stringify({ contentType, byteSize: totalBytes, storedAt: new Date().toISOString() }));
          state.shas.add(sha);
          state.usedBytes += totalBytes;
          consumeNonce(grant);
          reply(201, { sha256: sha, byteSize: totalBytes, contentType });
        } finally {
          activeShas.delete(sha);
        }
      }

      async function handleUploadAbort(sha) {
        uploadSessions.delete(sha);
        await rm(uploadPartPath(dir, sha), { force: true });
        await rm(uploadStatePath(dir, sha), { force: true });
        reply(200, { aborted: sha });
      }
    } catch (error) {
      log(`storage-node: request failed — ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        const payload = JSON.stringify({ error: "Storage node internal error" });
        res.writeHead(500, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...cors });
        res.end(payload);
      } else res.destroy();
    }
  });
}

// ---------------------------------------------------------------------------
// Heartbeat loop (node -> cloud, every 60s)
// ---------------------------------------------------------------------------

async function diskStats(dir) {
  try {
    const s = await statfs(dir);
    return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

function startHeartbeats({ config, dir, state, port, log }) {
  let pendingShas = [];
  let warnedOffline = false;
  const beat = async () => {
    try {
      const disk = await diskStats(dir);
      const scrub = computeScrubReport(pendingShas, state.shas);
      const result = await postJson(
        `${config.cloudUrl}/api/storage-node/heartbeat`,
        {
          nodeVersion: NODE_VERSION,
          diskTotalBytes: disk.totalBytes,
          diskFreeBytes: disk.freeBytes,
          usedBytes: state.usedBytes,
          itemCount: state.shas.size,
          lanAddresses: lanUrlsFor(networkInterfaces(), port),
          scrubbed: pendingShas.length > 0,
          verifiedShas: scrub.verified,
          missingShas: scrub.missing,
        },
        { authorization: `Bearer ${config.nodeToken}` },
      );
      if (result.status === 401) {
        log("storage-node: token revoked by the team — cloud sync stopped. Items keep serving locally; re-run --setup to re-pair.");
        pendingShas = [];
        return;
      }
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      pendingShas = Array.isArray(result.data.pendingShas) ? result.data.pendingShas : [];
      if (warnedOffline) {
        warnedOffline = false;
        log("storage-node: cloud reachable again — heartbeats resumed.");
      }
    } catch {
      if (!warnedOffline) {
        warnedOffline = true;
        log("storage-node: cloud unreachable — still serving the LAN; the team page will show this node as degraded until heartbeats resume.");
      }
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const HELP = `Vantage storage node ${NODE_VERSION}

Pair:   node server.mjs --setup --cloud https://your-vantage-host [--name pi-shop] [--dir DIR] [--quota-gb 20]
Serve:  node server.mjs [--dir DIR] [--port 8788] [--quota-gb 20] [--allow-origin URL]

Flags:
  --setup            Pair this machine with your team (prints an 8-char code to enter at /team/storage)
  --cloud URL        The hosted Vantage app URL (required with --setup)
  --name NAME        Node name shown to your team (default: this machine's hostname)
  --dir DIR          Data directory (default: $VANTAGE_STORAGE_DIR or ./vantage-storage)
  --port N           HTTP port to serve items on (default ${DEFAULT_PORT})
  --quota-gb N       Disk quota this node enforces for stored items (default ${DEFAULT_QUOTA_GB})
  --allow-origin URL Extra browser origin allowed by CORS (repeatable; the paired cloud origin
                     is always allowed — wildcard * is never used)
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (args.setup) {
    await runSetup(args);
    return;
  }

  const dir = args.dir ?? defaultDataDir();
  const config = await loadConfig(dir);
  if (!config?.nodeToken || !config.cloudUrl || !config.accessKeyHash) {
    throw new Error(`Not paired yet (no usable config at ${configPath(dir)}). Run: node server.mjs --setup --cloud https://your-vantage-host`);
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

  await mkdir(itemsRoot(dir), { recursive: true });
  await rm(tmpRoot(dir), { recursive: true, force: true }).catch(() => {});
  await mkdir(tmpRoot(dir), { recursive: true });
  // uploads/ survives restarts on purpose — that is what makes resume work.
  await mkdir(uploadsRoot(dir), { recursive: true });
  await gcStaleUploads(dir, console.error);
  const state = await scanStore(dir);
  console.error(
    `storage-node ${NODE_VERSION}: ${state.shas.size} item(s), ${formatBytes(state.usedBytes)} used of ${formatBytes(quotaBytes)} quota, data in ${dir}`,
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
  console.error("storage-node: reachable beyond this network ONLY via a public URL you set up (Cloudflare Tunnel / Tailscale) and paste into /team/storage.");
  startHeartbeats({ config, dir, state, port, log: console.error });
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
