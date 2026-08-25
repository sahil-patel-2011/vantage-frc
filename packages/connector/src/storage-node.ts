import { createHash, timingSafeEqual } from "node:crypto";
import type {
  CapabilityContext,
  CapabilityDetection,
  CapabilityReport,
  ConnectorCapability,
} from "./capability.js";

/**
 * storage-node capability — host team media (photos/video) from this machine: large
 * binary items live here, only metadata lives in the hosted database. The pure decision
 * logic below is ported 1:1 from packages/storage-node/server.mjs (which stays untouched
 * as the standalone single-file node); the HTTP item server itself lives in
 * ./node/storage-server.ts and is injected here as a `serve` function so this module —
 * and its tests — never open a socket.
 *
 * Networking truth (unchanged from the standalone node): on your LAN this machine serves
 * the shop/pit directly. From anywhere else it is only reachable if you give it a public
 * URL (Tailscale Funnel or cloudflared) and paste that URL into /team/storage. The cloud
 * cannot magically reach a NATed device.
 */

export const STORAGE_DEFAULT_PORT = 8788;
export const STORAGE_DEFAULT_QUOTA_GB = 20;
export const SHA256_RE = /^[0-9a-f]{64}$/;
/** Same unambiguous alphabet the cloud uses for pairing codes (no I/O/0/1). */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* ------------------------------------------------------------------ */
/* Pure helpers (ported from storage-node/server.mjs; exported for tests) */
/* ------------------------------------------------------------------ */

export function isValidSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** Content-addressed on-disk layout: ab/cd/abcdef… keeps directories small on a Pi's SD card. */
export function shardRelPath(sha256: string): string {
  if (!isValidSha256(sha256)) throw new Error("shardRelPath requires a lowercase hex sha256");
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Constant-time comparison of two hex digests (token auth must not leak timing). */
export function timingSafeEqualHex(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Normalize a human pairing code: strip separators/whitespace, uppercase, validate against
 * the unambiguous alphabet. Returns the bare 8-char code or null.
 */
export function normalizePairingCode(raw: unknown): string | null {
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
export function parseRange(
  header: unknown,
  size: number,
): { start: number; end: number } | "invalid" | null {
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
export function quotaDecision(input: {
  usedBytes: number;
  incomingBytes: number | null;
  quotaBytes: number;
}): { allowed: boolean; remainingBytes: number } {
  const remainingBytes = Math.max(0, input.quotaBytes - input.usedBytes);
  if (input.incomingBytes == null) return { allowed: remainingBytes > 0, remainingBytes };
  return { allowed: input.incomingBytes <= remainingBytes, remainingBytes };
}

/**
 * Incremental scrub: given the shas the cloud asked us to verify and a Set of shas actually
 * on disk, split into verified/missing. Pure so the honesty path is testable.
 */
export function computeScrubReport(
  pendingShas: unknown,
  onDisk: Set<string>,
): { verified: string[]; missing: string[] } {
  const verified: string[] = [];
  const missing: string[] = [];
  for (const sha of Array.isArray(pendingShas) ? pendingShas : []) {
    if (!isValidSha256(sha)) continue;
    (onDisk.has(sha) ? verified : missing).push(sha);
  }
  return { verified, missing };
}

export function formatBytes(bytes: number): string {
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
export function lanUrlsFor(
  interfaces: Record<string, Array<{ family: string; internal: boolean; address: string }> | undefined>,
  port: number,
): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */

export type StorageServerState = {
  shas: Set<string>;
  usedBytes: number;
};

export type StorageServerHandle = {
  close(): Promise<void>;
  port: number;
  state: StorageServerState;
  /** LAN URLs the running server is reachable on (empty when none). */
  lanUrls: string[];
};

export type StorageServeOptions = {
  dir: string;
  accessKeyHash: string;
  quotaBytes: number;
  port: number;
  name: string;
  log: (message: string) => void;
};

export type StorageServeFn = (options: StorageServeOptions) => Promise<StorageServerHandle>;

export type StorageNodeCapabilityOptions = {
  /**
   * Starts the real HTTP item server. Defaults to the node:http implementation in
   * ./node/storage-server.ts (lazy-imported inside start(), never at module scope).
   * Tests inject a fake.
   */
  serve?: StorageServeFn;
};

export class StorageNodeCapability implements ConnectorCapability {
  readonly id = "storage-node" as const;
  readonly label = "Team media storage";

  private handle: StorageServerHandle | null = null;
  private pendingShas: string[] = [];
  private lastScrub: { verified: string[]; missing: string[] } | null = null;

  constructor(private readonly options: StorageNodeCapabilityOptions = {}) {}

  async detect(ctx: CapabilityContext): Promise<CapabilityDetection> {
    const storage = ctx.config.storage;
    if (!storage?.accessKeyHash) {
      return {
        available: false,
        detail:
          "Setup required: enable storage in the host app so it can mint an access key and register it with your team (/team/storage).",
      };
    }
    if (!storage.dir) {
      return { available: false, detail: "Setup required: choose a data directory for stored items." };
    }
    return {
      available: true,
      detail: `Will serve items from ${storage.dir} on port ${storage.port ?? STORAGE_DEFAULT_PORT} (${formatBytes(
        storage.quotaBytes ?? STORAGE_DEFAULT_QUOTA_GB * 1024 ** 3,
      )} quota).`,
    };
  }

  async start(ctx: CapabilityContext): Promise<void> {
    const storage = ctx.config.storage;
    if (!storage?.accessKeyHash || !storage.dir) {
      throw new Error("storage-node started without an access key hash or data directory");
    }
    const serve =
      this.options.serve ??
      // node:http implementation, imported only when actually serving.
      (await import("./node/storage-server.js")).startStorageItemServer;
    this.handle = await serve({
      dir: storage.dir,
      accessKeyHash: storage.accessKeyHash,
      quotaBytes: storage.quotaBytes ?? STORAGE_DEFAULT_QUOTA_GB * 1024 ** 3,
      port: storage.port ?? STORAGE_DEFAULT_PORT,
      name: ctx.config.machineName,
      log: ctx.log,
    });
    ctx.log(
      `storage-node: serving ${this.handle.state.shas.size} item(s), ${formatBytes(this.handle.state.usedBytes)} used, port ${this.handle.port}.`,
    );
    try {
      // Serve until stopped. The scrub exchange rides the combined connector heartbeat:
      // the cloud sends pendingShas in the heartbeat response (onHeartbeatResponse) and
      // reads verified/missing back from status().data on the next beat.
      while (!ctx.signal.aborted) {
        this.lastScrub = computeScrubReport(this.pendingShas, this.handle.state.shas);
        this.pendingShas = [];
        await ctx.clock.sleep(60_000, ctx.signal);
      }
    } finally {
      const handle = this.handle;
      this.handle = null;
      if (handle) await handle.close().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle) await handle.close().catch(() => {});
  }

  onHeartbeatResponse(data: Record<string, unknown>): void {
    this.pendingShas = Array.isArray(data.pendingShas)
      ? data.pendingShas.filter((sha): sha is string => isValidSha256(sha))
      : [];
  }

  status(): CapabilityReport {
    if (!this.handle) return { detail: "Item server is not running." };
    return {
      detail: `${this.handle.state.shas.size} item(s), ${formatBytes(this.handle.state.usedBytes)} used, port ${this.handle.port}.`,
      data: {
        itemCount: this.handle.state.shas.size,
        usedBytes: this.handle.state.usedBytes,
        port: this.handle.port,
        lanUrls: this.handle.lanUrls,
        ...(this.lastScrub
          ? { scrubbed: true, verifiedShas: this.lastScrub.verified, missingShas: this.lastScrub.missing }
          : { scrubbed: false }),
      },
    };
  }
}
