import { createECDH, createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./encode";
import {
  audienceForEndpoint,
  pushSetupStatus,
  signVapidJwt,
  vapidAuthorizationHeader,
  vapidConfig,
} from "./vapid";

function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: base64UrlEncode(ecdh.getPublicKey()),
    privateKey: base64UrlEncode(ecdh.getPrivateKey()),
  };
}

const KEYS = generateVapidKeys();
const SUBJECT = "mailto:ops@example.org";

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  setEnv({
    VAPID_PUBLIC_KEY: undefined,
    VAPID_PRIVATE_KEY: undefined,
    VAPID_SUBJECT: undefined,
  });
});

describe("pushSetupStatus", () => {
  it("reports setup_required with every missing variable named", () => {
    const status = pushSetupStatus();
    expect(status.state).toBe("setup_required");
    if (status.state !== "setup_required") return;
    expect(status.missing).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(status.detail).toMatch(/in-app inbox/);
    expect(vapidConfig()).toBeNull();
  });

  it("rejects keys of the wrong length instead of failing at send time", () => {
    setEnv({
      VAPID_PUBLIC_KEY: base64UrlEncode(Buffer.alloc(32)),
      VAPID_PRIVATE_KEY: base64UrlEncode(Buffer.alloc(16)),
      VAPID_SUBJECT: "not-a-contact",
    });
    const status = pushSetupStatus();
    expect(status.state).toBe("setup_required");
    if (status.state !== "setup_required") return;
    expect(status.missing.join(" ")).toMatch(/65-byte/);
    expect(status.missing.join(" ")).toMatch(/32-byte/);
    expect(status.missing.join(" ")).toMatch(/mailto/);
  });

  it("is ready once all three are valid", () => {
    setEnv({
      VAPID_PUBLIC_KEY: KEYS.publicKey,
      VAPID_PRIVATE_KEY: KEYS.privateKey,
      VAPID_SUBJECT: SUBJECT,
    });
    const status = pushSetupStatus();
    expect(status).toEqual({ state: "ready", publicKey: KEYS.publicKey, subject: SUBJECT });
  });
});

describe("signVapidJwt", () => {
  const config = { ...KEYS, subject: SUBJECT };

  it("signs a verifiable ES256 JWT over the endpoint origin", () => {
    const jwt = signVapidJwt(config, "https://fcm.googleapis.com", { nowSeconds: 1_700_000_000 });
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(base64UrlDecode(header).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(base64UrlDecode(payload).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_700_000_000 + 12 * 60 * 60,
      sub: SUBJECT,
    });

    const raw = base64UrlDecode(KEYS.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64UrlEncode(raw.subarray(1, 33)),
        y: base64UrlEncode(raw.subarray(33, 65)),
      },
    });
    const verified = verify(
      null,
      Buffer.from(`${header}.${payload}`, "utf8"),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      base64UrlDecode(signature),
    );
    expect(verified).toBe(true);
  });

  it("clamps exp to the RFC 8292 24-hour maximum", () => {
    const jwt = signVapidJwt(config, "https://example.push", {
      nowSeconds: 1_000_000,
      ttlSeconds: 60 * 60 * 24 * 30,
    });
    const payload = JSON.parse(base64UrlDecode(jwt.split(".")[1]).toString());
    expect(payload.exp).toBe(1_000_000 + 24 * 60 * 60);
  });

  it("builds the single-header vapid scheme with the raw public key", () => {
    const header = vapidAuthorizationHeader(
      config,
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
    );
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(header.endsWith(`k=${KEYS.publicKey}`)).toBe(true);
    const aud = JSON.parse(
      base64UrlDecode(header.slice("vapid t=".length).split(",")[0].split(".")[1]).toString(),
    ).aud;
    // aud is the ORIGIN, never the full endpoint path.
    expect(aud).toBe("https://updates.push.services.mozilla.com");
  });
});

describe("audienceForEndpoint", () => {
  it("strips path and query", () => {
    expect(audienceForEndpoint("https://push.example/a/b?c=d")).toBe("https://push.example");
  });
});
