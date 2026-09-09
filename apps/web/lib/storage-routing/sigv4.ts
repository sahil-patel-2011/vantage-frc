/**
 * AWS Signature Version 4 — query-string ("presigned URL") signing, implemented
 * with node:crypto only.
 *
 * Why hand-rolled instead of `@aws-sdk/*`: the only thing this deployment needs
 * from an S3-compatible store is a URL the BROWSER can PUT to and GET from, so
 * bytes never transit a serverless function with a 4.5 MB body limit. That is
 * about 80 lines of HMAC. Pulling in the AWS SDK (several MB, dozens of
 * transitive packages) to produce one signed string would be a bad trade in a
 * repo whose build is deliberately dependency-light.
 *
 * Correctness is pinned to the worked example in the AWS documentation
 * ("Signature Calculations for the Authorization Header: Transferring Payload
 * in a Single Chunk" / query-string auth) — see sigv4.test.ts, which asserts
 * the canonical request, the string to sign, and the final signature against
 * the published values. If any of those three drift, the test says which step
 * broke rather than just "the URL 403s".
 *
 * Server-only (node:crypto). Never import from a client component.
 */

import { createHash, createHmac } from "node:crypto";

export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";

/**
 * RFC 3986 percent-encoding. `encodeURIComponent` leaves `!'()*` alone and AWS
 * requires them encoded; a filename containing an apostrophe is not exotic, so
 * getting this wrong is a real 403 rather than a theoretical one.
 */
export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode a path, keeping `/` as a separator (S3 keys may contain slashes). */
export function canonicalUri(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.split("/").map(rfc3986Encode).join("/");
}

/** Sorted, encoded `k=v&k=v`. AWS sorts by encoded key, then encoded value. */
export function canonicalQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** `YYYYMMDDTHHMMSSZ` — the only date format SigV4 accepts. */
export function amzDate(when: Date): string {
  return `${when.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

export function credentialScope(dateStamp: string, region: string, service: string): string {
  return `${dateStamp}/${region}/${service}/aws4_request`;
}

/** The four-step key derivation: date → region → service → "aws4_request". */
export function signingKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  /** Origin only, e.g. https://abc.r2.cloudflarestorage.com (no path). */
  endpoint: string;
  /** Object path relative to the endpoint, e.g. `/my-bucket/orgs/1/file.stl`. */
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Seconds the URL stays valid (AWS caps this at 7 days). */
  expiresInSeconds: number;
  /** Extra query parameters to sign (e.g. response-content-disposition). */
  query?: Record<string, string>;
  /** Session token for temporary credentials; omitted when unused. */
  sessionToken?: string;
  /** Injected in tests so the published AWS vector is reproducible. */
  now?: Date;
};

export type PresignResult = {
  url: string;
  /** Exposed so the unit test can pin every intermediate, not just the URL. */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  expiresAt: Date;
};

/**
 * Presign one request. The payload is signed as UNSIGNED-PAYLOAD, which is what
 * S3 requires for query-string auth: the browser streams the body and cannot
 * know its hash before sending.
 */
export function presign(input: PresignInput): PresignResult {
  const now = input.now ?? new Date();
  const stamp = amzDate(now);
  const dateStamp = stamp.slice(0, 8);
  const scope = credentialScope(dateStamp, input.region, input.service);
  const host = new URL(input.endpoint).host;

  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": SIGV4_ALGORITHM,
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(Math.max(1, Math.floor(input.expiresInSeconds))),
    "X-Amz-SignedHeaders": "host",
  };
  if (input.sessionToken) query["X-Amz-Security-Token"] = input.sessionToken;

  const canonicalRequest = [
    input.method,
    canonicalUri(input.path),
    canonicalQueryString(query),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [SIGV4_ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(input.secretAccessKey, dateStamp, input.region, input.service),
  )
    .update(stringToSign, "utf8")
    .digest("hex");

  const base = input.endpoint.replace(/\/+$/, "");
  const url = `${base}${canonicalUri(input.path)}?${canonicalQueryString(query)}&X-Amz-Signature=${signature}`;

  return {
    url,
    canonicalRequest,
    stringToSign,
    signature,
    expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000),
  };
}
