/**
 * VAPID (RFC 8292) application-server identification.
 *
 * Keys come from env and NOTHING is generated at runtime — a rotating server key
 * would silently invalidate every stored subscription. When the keys are absent the
 * whole push path reports `setup_required` and the product falls back to in-app
 * notifications only; it never pretends a push was delivered.
 *
 * VAPID_PUBLIC_KEY  — base64url, 65-byte uncompressed P-256 point (starts with 0x04)
 * VAPID_PRIVATE_KEY — base64url, 32-byte raw private scalar
 * VAPID_SUBJECT     — `mailto:` or `https:` contact the push service can reach
 */
import { createPrivateKey, sign } from "node:crypto";
import { base64UrlDecode, base64UrlEncode, isBase64UrlOfLength } from "./encode";

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type PushSetupStatus =
  | { state: "ready"; publicKey: string; subject: string }
  | { state: "setup_required"; missing: string[]; detail: string };

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function isValidSubject(subject: string): boolean {
  return /^mailto:\S+@\S+$/i.test(subject) || /^https:\/\/\S+$/i.test(subject);
}

/**
 * Honest setup state for the UI. Reports every missing/invalid piece at once so a
 * coach configuring this does not fix one variable per deploy.
 */
export function pushSetupStatus(): PushSetupStatus {
  const publicKey = readEnv("VAPID_PUBLIC_KEY");
  const privateKey = readEnv("VAPID_PRIVATE_KEY");
  const subject = readEnv("VAPID_SUBJECT");

  const missing: string[] = [];
  if (!publicKey) missing.push("VAPID_PUBLIC_KEY");
  else if (!isBase64UrlOfLength(publicKey, 65)) missing.push("VAPID_PUBLIC_KEY (must be a 65-byte base64url P-256 point)");
  if (!privateKey) missing.push("VAPID_PRIVATE_KEY");
  else if (!isBase64UrlOfLength(privateKey, 32)) missing.push("VAPID_PRIVATE_KEY (must be a 32-byte base64url scalar)");
  if (!subject) missing.push("VAPID_SUBJECT");
  else if (!isValidSubject(subject)) missing.push("VAPID_SUBJECT (must be mailto: or https:)");

  if (missing.length > 0) {
    return {
      state: "setup_required",
      missing,
      detail:
        "Web push is not configured. Notifications still land in the in-app inbox; nothing is sent to phones until VAPID keys are set. See docs/PUSH_NOTIFICATIONS.md.",
    };
  }
  return { state: "ready", publicKey, subject };
}

export function vapidConfig(): VapidConfig | null {
  const status = pushSetupStatus();
  if (status.state !== "ready") return null;
  return {
    publicKey: readEnv("VAPID_PUBLIC_KEY"),
    privateKey: readEnv("VAPID_PRIVATE_KEY"),
    subject: readEnv("VAPID_SUBJECT"),
  };
}

/** `aud` for the VAPID JWT is the push service ORIGIN, never the full endpoint. */
export function audienceForEndpoint(endpoint: string): string {
  return new URL(endpoint).origin;
}

/** Default 12h; RFC 8292 caps `exp` at 24h from now. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

function toJwtSigningKey(config: VapidConfig) {
  const publicKey = base64UrlDecode(config.publicKey);
  // Rebuild a JWK from the raw scalar + the configured point so node can sign with it.
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(base64UrlDecode(config.privateKey)),
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
    },
  });
}

/** ES256 JWT: base64url(header).base64url(payload).base64url(r||s). */
export function signVapidJwt(
  config: VapidConfig,
  audience: string,
  options?: { nowSeconds?: number; ttlSeconds?: number },
): string {
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = now + Math.min(options?.ttlSeconds ?? DEFAULT_TTL_SECONDS, 24 * 60 * 60);
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64UrlEncode(
    Buffer.from(JSON.stringify({ aud: audience, exp, sub: config.subject })),
  );
  const signingInput = Buffer.from(`${header}.${payload}`, "utf8");
  // 'ieee-p1363' is the raw r||s form JWS requires; the DER default is rejected.
  const signature = sign(null, signingInput, {
    key: toJwtSigningKey(config),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}

/** RFC 8292 §3.1 header, the single-header `vapid` scheme. */
export function vapidAuthorizationHeader(
  config: VapidConfig,
  endpoint: string,
  options?: { nowSeconds?: number },
): string {
  const jwt = signVapidJwt(config, audienceForEndpoint(endpoint), options);
  return `vapid t=${jwt}, k=${config.publicKey}`;
}
