/**
 * S3-compatible object storage — the third home for a file's bytes, alongside
 * the hosted database ('cloud'/'db') and the team's paired storage node.
 *
 * Why it exists: the database path is capped by the platform's request-body
 * limit (4 MiB on Vercel — see caps.ts) and the node path needs hardware the
 * team has to own and expose. A team with neither has nowhere to put a 300 MB
 * practice-match video. An object store fixes that without putting bytes
 * through this deployment: the browser PUTs straight to a presigned URL and
 * GETs straight from one.
 *
 * Configuration is deliberately all-or-nothing. Five environment variables,
 * and until every one of them is set this module reports `setup_required` with
 * the exact names that are missing — it never half-works, and the upload plan
 * says so out loud instead of failing at the end of a long upload. The owner
 * intends to point this at Supabase Storage's S3 endpoint; Cloudflare R2 works
 * with the same five values.
 *
 * Server-only (node:crypto via sigv4). Never import from a client component.
 */

import { presign } from "./sigv4";

export const OBJECT_STORE_ENV_KEYS = [
  "DRIVE_OBJECT_ENDPOINT",
  "DRIVE_OBJECT_BUCKET",
  "DRIVE_OBJECT_ACCESS_KEY",
  "DRIVE_OBJECT_SECRET_KEY",
  "DRIVE_OBJECT_REGION",
] as const;

export type ObjectStoreEnv = Partial<Record<(typeof OBJECT_STORE_ENV_KEYS)[number], string>>;

export type ObjectStoreConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type ObjectStoreStatus =
  | { configured: true; config: ObjectStoreConfig }
  | { configured: false; missing: string[]; reason: string };

/** Upload URLs are short-lived; a stalled browser tab re-asks rather than holding one open. */
export const OBJECT_PUT_TTL_SECONDS = 30 * 60;
/** Download URLs live long enough for video seeking without becoming a durable link. */
export const OBJECT_GET_TTL_SECONDS = 60 * 60;

/**
 * Read the five env vars. Returns the honest missing-key list rather than a
 * boolean, because "object storage is off" and "object storage is misconfigured
 * because someone forgot the region" deserve different sentences.
 */
export function objectStoreStatus(env: ObjectStoreEnv = process.env as ObjectStoreEnv): ObjectStoreStatus {
  const values = OBJECT_STORE_ENV_KEYS.map((key) => [key, (env[key] ?? "").trim()] as const);
  const missing = values.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    return {
      configured: false,
      missing,
      reason:
        missing.length === OBJECT_STORE_ENV_KEYS.length
          ? "Object storage is not configured for this deployment. See docs/DEPLOYMENT.md."
          : `Object storage is partly configured — still missing ${missing.join(", ")}. See docs/DEPLOYMENT.md.`,
    };
  }
  const map = Object.fromEntries(values) as Record<(typeof OBJECT_STORE_ENV_KEYS)[number], string>;
  let endpoint: string;
  try {
    const parsed = new URL(map.DRIVE_OBJECT_ENDPOINT);
    if (parsed.protocol !== "https:") {
      return {
        configured: false,
        missing: ["DRIVE_OBJECT_ENDPOINT"],
        reason: `DRIVE_OBJECT_ENDPOINT must be an https URL (got ${parsed.protocol}//). A browser on a secure page cannot upload to plain http.`,
      };
    }
    // Path-style addressing: the bucket is the first path segment. Both
    // Supabase Storage's S3 endpoint and Cloudflare R2 accept that, and it
    // avoids per-bucket DNS the team would have to set up.
    endpoint = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return {
      configured: false,
      missing: ["DRIVE_OBJECT_ENDPOINT"],
      reason: "DRIVE_OBJECT_ENDPOINT is not a valid URL.",
    };
  }

  return {
    configured: true,
    config: {
      endpoint,
      bucket: map.DRIVE_OBJECT_BUCKET,
      accessKeyId: map.DRIVE_OBJECT_ACCESS_KEY,
      secretAccessKey: map.DRIVE_OBJECT_SECRET_KEY,
      region: map.DRIVE_OBJECT_REGION,
    },
  };
}

/**
 * The object key for one Drive file. Prefixed with the org id exactly like
 * cad_document_versions.storage_key (0474): the key itself carries tenancy, so
 * a leaked key cannot be edited into another team's prefix without also
 * defeating the signature. Content-addressed within the org, like the storage
 * node's own layout, so re-uploading identical bytes costs nothing.
 */
export function driveObjectKey(orgId: string, sha256: string): string {
  return `drive/${orgId}/${sha256}`;
}

function objectPath(config: ObjectStoreConfig, key: string): string {
  const basePath = new URL(config.endpoint).pathname.replace(/\/+$/, "");
  return `${basePath}/${config.bucket}/${key}`;
}

export type PresignedTransfer = {
  url: string;
  expiresAt: string;
  /** Headers the browser MUST send with the PUT for the signature to hold. */
  headers: Record<string, string>;
};

/** A URL the browser can PUT the file's bytes to, directly. */
export function presignObjectPut(
  config: ObjectStoreConfig,
  key: string,
  options: { expiresInSeconds?: number; now?: Date } = {},
): PresignedTransfer {
  const result = presign({
    method: "PUT",
    endpoint: new URL(config.endpoint).origin,
    path: objectPath(config, key),
    region: config.region,
    service: "s3",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresInSeconds: options.expiresInSeconds ?? OBJECT_PUT_TTL_SECONDS,
    ...(options.now ? { now: options.now } : {}),
  });
  // Only `host` is signed, so the browser is free to send its own
  // content-type; adding it here would make the signature depend on a header
  // fetch() rewrites, which is a classic source of silent 403s.
  return { url: result.url, expiresAt: result.expiresAt.toISOString(), headers: {} };
}

/** A URL the browser can GET the bytes from, with the right download filename. */
export function presignObjectGet(
  config: ObjectStoreConfig,
  key: string,
  options: { fileName?: string; download?: boolean; expiresInSeconds?: number; now?: Date } = {},
): PresignedTransfer {
  const query: Record<string, string> = {};
  if (options.fileName) {
    const safe = options.fileName.replace(/["\\\r\n]/g, "_");
    query["response-content-disposition"] = `${options.download ? "attachment" : "inline"}; filename="${safe}"`;
  }
  const result = presign({
    method: "GET",
    endpoint: new URL(config.endpoint).origin,
    path: objectPath(config, key),
    region: config.region,
    service: "s3",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresInSeconds: options.expiresInSeconds ?? OBJECT_GET_TTL_SECONDS,
    query,
    ...(options.now ? { now: options.now } : {}),
  });
  return { url: result.url, expiresAt: result.expiresAt.toISOString(), headers: {} };
}
