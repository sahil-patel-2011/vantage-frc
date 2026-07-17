import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  FUSION_RELAY_PROTOCOL_VERSION,
  FUSION_RELAY_SUPPORTED_PROTOCOLS,
  buildCadCompatibilityMatrix,
  buildTestFusionEnvelope,
  checkRelayCompatibility,
  createMockFusionPluginHandler,
  isSupportedRelayProtocol,
  semverGte,
  signFusionRelayJob,
  verifyFusionRelayJob,
} from "../src";

describe("Fusion relay protocol", () => {
  it("pins a versioned protocol id and support list", () => {
    expect(FUSION_RELAY_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d+$/);
    expect(FUSION_RELAY_SUPPORTED_PROTOCOLS).toContain(FUSION_RELAY_PROTOCOL_VERSION);
    expect(isSupportedRelayProtocol(FUSION_RELAY_PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedRelayProtocol("1999-01-0")).toBe(false);
  });

  it("rejects expired, tampered, and unknown-protocol envelopes", () => {
    const secret = "relay-protocol-fixture";
    const signed = signFusionRelayJob(
      (({ signature: _s, ...rest }) => {
        void _s;
        return rest;
      })(buildTestFusionEnvelope()),
      secret,
    );
    expect(verifyFusionRelayJob(signed, secret)).toBe(true);
    expect(verifyFusionRelayJob({ ...signed, signature: "deadbeef" }, secret)).toBe(false);
    const expired = signFusionRelayJob(
      (({ signature: _s, ...rest }) => {
        void _s;
        return { ...rest, expiresAt: new Date(Date.now() - 1000).toISOString() };
      })(buildTestFusionEnvelope()),
      secret,
    );
    expect(verifyFusionRelayJob(expired, secret)).toBe(false);
    const wrongVersion = signFusionRelayJob(
      (({ signature: _s, ...rest }) => {
        void _s;
        return { ...rest, version: "1999-01-0" };
      })(buildTestFusionEnvelope()),
      secret,
    );
    expect(verifyFusionRelayJob(wrongVersion, secret)).toBe(false);
  });

  it("round-trips signed execute through the mock Fusion HTTP plugin", async () => {
    const secret = "mock-http-secret";
    const handler = createMockFusionPluginHandler(secret);
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as { protocol: string; mock: boolean };
      expect(healthBody.protocol).toBe(FUSION_RELAY_PROTOCOL_VERSION);
      expect(healthBody.mock).toBe(true);

      const envelope = signFusionRelayJob(
        (({ signature: _s, ...rest }) => {
          void _s;
          return rest;
        })(
          buildTestFusionEnvelope({
            operation: {
              operation: "create_sketch",
              parameters: {},
              requiresApproval: true,
              reason: "ci",
            },
          }),
        ),
        secret,
      );
      const executed = await fetch(`${base}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
      expect(executed.status).toBe(200);
      const body = (await executed.json()) as {
        topology: { fingerprint: string };
        output: { mockFusion: boolean };
      };
      expect(body.topology.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(body.output.mockFusion).toBe(true);

      const bad = await fetch(`${base}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...envelope, signature: "nope" }),
      });
      expect(bad.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("CAD compatibility matrix", () => {
  it("compares semver floors", () => {
    expect(semverGte("0.1.0", "0.1.0")).toBe(true);
    expect(semverGte("0.2.0", "0.1.0")).toBe(true);
    expect(semverGte("0.0.9", "0.1.0")).toBe(false);
    expect(semverGte("bad", "0.1.0")).toBe(false);
  });

  it("flags unsupported protocol and Linux Fusion add-in", () => {
    const ok = checkRelayCompatibility({
      protocol: FUSION_RELAY_PROTOCOL_VERSION,
      cliVersion: "0.1.0",
      platform: "win32",
    });
    expect(ok.compatible).toBe(true);

    const badProtocol = checkRelayCompatibility({ protocol: "legacy-0", platform: "macos" });
    expect(badProtocol.compatible).toBe(false);
    expect(badProtocol.protocolOk).toBe(false);

    const linuxAddin = checkRelayCompatibility({
      protocol: FUSION_RELAY_PROTOCOL_VERSION,
      platform: "linux",
      addinVersion: "0.1.0",
    });
    expect(linuxAddin.compatible).toBe(false);
    expect(linuxAddin.platformOk).toBe(false);
  });

  it("builds a stable public matrix shape", () => {
    const matrix = buildCadCompatibilityMatrix(new Date("2026-07-17T00:00:00.000Z"));
    expect(matrix.protocol.current).toBe(FUSION_RELAY_PROTOCOL_VERSION);
    expect(matrix.osSupport).toHaveLength(3);
    expect(matrix.endpoints.compatibility).toBe("/api/cad/compatibility");
    expect(matrix.artifacts.packageCommand).toBe("npm run cad:package");
  });
});
