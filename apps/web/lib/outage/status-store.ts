import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * A tiny key-value store for outage state that does NOT live in the database it reports on.
 *
 * When the NAS is down, every table is out of reach — the open incident, the "limited" banner
 * flag and the list of people to email have to be somewhere else. That is an Upstash-compatible
 * REST store (OUTAGE_REDIS_URL / OUTAGE_REDIS_TOKEN, or the rate limiter's RATE_LIMIT_REDIS_URL /
 * RATE_LIMIT_REDIS_TOKEN), with an in-memory fallback.
 *
 * The fallback is per server instance. Without a shared store each warm instance keeps its own
 * incident, so the owner can get the same alert once from each instance (capped per instance in
 * incident.ts), and a contact list saved by one instance is invisible to the next — which is why
 * the outage console asks for the shared store before it can email everyone.
 *
 * Anything holding people's email addresses is sealed (AES-256-GCM, key derived from
 * BETTER_AUTH_SECRET with HKDF) before it leaves the process, so the provider only sees
 * ciphertext.
 */

export type OutageStoreKind = "upstash" | "memory";

export type SetOptions = {
  /** Expire the key after this many seconds. */
  ttlSeconds?: number;
  /** Only write when the key does not exist yet (a lock). Resolves false when it existed. */
  onlyIfAbsent?: boolean;
};

export interface OutageStore {
  readonly kind: OutageStoreKind;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const PREFIX = "vantage:outage:";
const MEMORY_MAX_KEYS = 500;
const REQUEST_TIMEOUT_MS = 2_500;

type EnvSource = Record<string, string | undefined>;

function env(name: string, source: EnvSource = process.env) {
  const value = source[name]?.trim() || "";
  return value === "[SENSITIVE]" ? "" : value;
}

export class MemoryOutageStore implements OutageStore {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, { value: string; expiresAt: number | null }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    if (options.onlyIfAbsent && this.live(key)) return false;
    if (!this.entries.has(key) && this.entries.size >= MEMORY_MAX_KEYS) {
      for (const [name] of this.entries) {
        if (this.live(name) == null) continue;
        // Oldest first: Map keeps insertion order.
        this.entries.delete(name);
        break;
      }
    }
    this.entries.set(key, {
      value,
      expiresAt: options.ttlSeconds ? this.now() + options.ttlSeconds * 1000 : null,
    });
    return true;
  }

  async delete(key: string) {
    this.entries.delete(key);
  }
}

/** Upstash REST: POST the command as a JSON array to the base URL. */
export class UpstashOutageStore implements OutageStore {
  readonly kind = "upstash" as const;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    const response = await this.fetchImpl(this.url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Outage store answered ${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (body.error) throw new Error("Outage store refused the command");
    return body.result ?? null;
  }

  async get(key: string) {
    const value = await this.command(["GET", PREFIX + key]);
    return typeof value === "string" ? value : null;
  }

  async set(key: string, value: string, options: SetOptions = {}) {
    const args = ["SET", PREFIX + key, value];
    if (options.ttlSeconds) args.push("EX", String(Math.max(1, Math.floor(options.ttlSeconds))));
    if (options.onlyIfAbsent) args.push("NX");
    const result = await this.command(args);
    return result === "OK";
  }

  async delete(key: string) {
    await this.command(["DEL", PREFIX + key]);
  }
}

/**
 * Shared store first; when it errors (its own outage, a bad token), the same call goes to the
 * in-memory store so an alert is still possible from this instance.
 */
export class FallbackOutageStore implements OutageStore {
  private warned = false;

  constructor(
    private readonly primary: OutageStore,
    private readonly fallback: OutageStore,
    private readonly log: (message: string) => void = (message) => console.warn(message),
  ) {}

  get kind() {
    return this.primary.kind;
  }

  private async run<T>(work: (store: OutageStore) => Promise<T>): Promise<T> {
    try {
      return await work(this.primary);
    } catch {
      if (!this.warned) {
        this.warned = true;
        this.log("[outage] The shared outage store did not answer; using this server's memory for now.");
      }
      return work(this.fallback);
    }
  }

  get(key: string) {
    return this.run((store) => store.get(key));
  }

  set(key: string, value: string, options?: SetOptions) {
    return this.run((store) => store.set(key, value, options));
  }

  delete(key: string) {
    return this.run((store) => store.delete(key));
  }
}

export function outageStoreConfig(source: EnvSource = process.env) {
  const own = { url: env("OUTAGE_REDIS_URL", source), token: env("OUTAGE_REDIS_TOKEN", source) };
  if (own.url && own.token) return { ...own, source: "OUTAGE_REDIS" as const };
  const shared = { url: env("RATE_LIMIT_REDIS_URL", source), token: env("RATE_LIMIT_REDIS_TOKEN", source) };
  if (shared.url && shared.token) return { ...shared, source: "RATE_LIMIT_REDIS" as const };
  return null;
}

let cached: OutageStore | null = null;
const memory = new MemoryOutageStore();

/** The process-wide store: Upstash when configured (with memory as its fallback), else memory. */
export function getOutageStore(): OutageStore {
  if (cached) return cached;
  const config = outageStoreConfig();
  cached = config ? new FallbackOutageStore(new UpstashOutageStore(config.url, config.token), memory) : memory;
  return cached;
}

/** Tests only. */
export function setOutageStoreForTests(store: OutageStore | null) {
  cached = store;
}

export async function readJson<T>(store: OutageStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(store: OutageStore, key: string, value: unknown, options?: SetOptions) {
  return store.set(key, JSON.stringify(value), options);
}

// ---------------------------------------------------------------------------------------------
// Sealing values that hold people's email addresses.

const HKDF_SALT = "vantage-outage-store";
const HKDF_INFO = "vantage outage store v1: service notice recipients";
const VERSION = "v1";

export class OutageSecretMissingError extends Error {
  constructor() {
    super("BETTER_AUTH_SECRET is required to protect the outage contact list.");
    this.name = "OutageSecretMissingError";
  }
}

/** BETTER_AUTH_SECRET; a fixed local value outside production so dev and tests run. */
export function outageSecret(source: EnvSource = process.env): string {
  const secret = env("BETTER_AUTH_SECRET", source);
  if (secret) return secret;
  if (source.NODE_ENV === "production") throw new OutageSecretMissingError();
  return "local-outage-store-secret";
}

function sealingKey(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

/** AES-256-GCM: `v1.` + base64url(iv ‖ tag ‖ ciphertext). `label` is bound as associated data. */
export function sealValue(plaintext: string, label: string, secret = outageSecret()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(secret), iv);
  cipher.setAAD(Buffer.from(label, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}

/** Throws when the value was not sealed with this secret and label, or was changed. */
export function openValue(sealed: string, label: string, secret = outageSecret()): string {
  const [version, body] = sealed.split(".");
  if (version !== VERSION || !body) throw new Error("Unrecognised sealed value");
  const raw = Buffer.from(body, "base64url");
  if (raw.length < 29) throw new Error("Sealed value is too short");
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(secret), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(label, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
