import { describe, expect, it } from "vitest";
import { PairingFlow, configFromPairing } from "../src/pairing.js";
import { DEFAULT_CONNECTOR_ENDPOINTS } from "../src/endpoints.js";
import { CONNECTOR_VERSION } from "../src/version.js";
import { FakeTransport, ManualClock, ok } from "./helpers.js";

const BASE = "https://vantage-frc-web.vercel.app";

function startResponse(overrides: Record<string, unknown> = {}) {
  return ok({
    userCode: "ABCD2345",
    verificationUri: `${BASE}/team/connector`,
    pollToken: "poll_secret",
    interval: 3,
    expiresIn: 600,
    ...overrides,
  });
}

function flow(transport: FakeTransport, clock = new ManualClock()) {
  return new PairingFlow({
    transport,
    clock,
    baseUrl: BASE,
    machineName: "shop-pc",
    endpoints: DEFAULT_CONNECTOR_ENDPOINTS,
    requestedCapabilities: ["ai-bridge", "local-models"],
  });
}

describe("pairing state machine", () => {
  it("walks idle → waiting_approval → approved and carries the device identity", async () => {
    const polls: Array<Record<string, unknown>> = [
      { status: "pending" },
      { status: "pending" },
      { status: "approved", deviceToken: "tok_new", deviceId: "dev-5", orgId: "org-9" },
    ];
    const transport = new FakeTransport([
      { match: "/api/connector/pair/start", handler: () => startResponse() },
      { match: "/api/connector/pair/poll", handler: () => ok(polls.shift() ?? { status: "pending" }) },
    ]);
    const pairing = flow(transport);
    expect(pairing.state.phase).toBe("idle");

    const started = await pairing.start();
    expect(started.phase).toBe("waiting_approval");
    if (started.phase !== "waiting_approval") throw new Error("unreachable");
    expect(started.userCode).toBe("ABCD2345");
    expect(started.verificationUri).toContain("/team/connector");
    expect(started.intervalMs).toBe(3000);

    expect((await pairing.pollOnce()).phase).toBe("waiting_approval"); // pending
    expect((await pairing.pollOnce()).phase).toBe("waiting_approval"); // pending
    const approved = await pairing.pollOnce();
    expect(approved.phase).toBe("approved");
    if (approved.phase !== "approved") throw new Error("unreachable");
    expect(approved.result).toEqual({ deviceToken: "tok_new", deviceId: "dev-5", orgId: "org-9" });

    // Wire contract: start sent machine identity + connector version + requested capabilities…
    const startRequest = transport.requests[0]!;
    expect(startRequest.body).toEqual({
      machineName: "shop-pc",
      connectorVersion: CONNECTOR_VERSION,
      capabilities: ["ai-bridge", "local-models"],
    });
    // …and every poll carried the poll token (the device-side pairing secret).
    for (const request of transport.requests.slice(1)) {
      expect(request.body).toEqual({ pollToken: "poll_secret" });
    }
  });

  it("reports denial honestly", async () => {
    const transport = new FakeTransport([
      { match: "/pair/start", handler: () => startResponse() },
      { match: "/pair/poll", handler: () => ok({ status: "denied" }) },
    ]);
    const pairing = flow(transport);
    await pairing.start();
    const state = await pairing.pollOnce();
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") throw new Error("unreachable");
    expect(state.reason).toBe("denied");
  });

  it("expires locally when the approval window lapses, even if the server never says so", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport([
      { match: "/pair/start", handler: () => startResponse({ expiresIn: 600 }) },
      { match: "/pair/poll", handler: () => ok({ status: "pending" }) },
    ]);
    const pairing = flow(transport, clock);
    await pairing.start();
    await clock.advance(601_000);
    const state = await pairing.pollOnce();
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") throw new Error("unreachable");
    expect(state.reason).toBe("expired");
  });

  it("stays waiting through a transient poll network blip instead of failing", async () => {
    let calls = 0;
    const transport = new FakeTransport([
      { match: "/pair/start", handler: () => startResponse() },
      {
        match: "/pair/poll",
        handler: () => {
          calls += 1;
          if (calls === 1) throw new Error("fetch failed: ECONNRESET");
          return ok({ status: "approved", deviceToken: "tok", deviceId: null, orgId: null });
        },
      },
    ]);
    const pairing = flow(transport);
    await pairing.start();
    expect((await pairing.pollOnce()).phase).toBe("waiting_approval"); // blip swallowed
    expect((await pairing.pollOnce()).phase).toBe("approved");
  });

  it("fails with the server's error message when pairing cannot start", async () => {
    const transport = new FakeTransport([
      { match: "/pair/start", handler: () => ok({ error: "Connector pairing is not enabled yet" }, 404) },
    ]);
    const state = await flow(transport).start();
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") throw new Error("unreachable");
    expect(state.detail).toContain("not enabled yet");
  });

  it("fails honestly when the host itself is unreachable", async () => {
    const state = await flow(new FakeTransport([])).start();
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") throw new Error("unreachable");
    expect(state.detail).toContain(BASE);
  });

  it("configFromPairing produces a saveable config with chosen toggles", () => {
    const config = configFromPairing(
      { deviceToken: "tok", deviceId: "dev", orgId: "org" },
      { baseUrl: BASE, machineName: "pi-shop", capabilities: { "storage-node": true } },
    );
    expect(config.version).toBe(1);
    expect(config.deviceToken).toBe("tok");
    expect(config.capabilities).toEqual({ "storage-node": true });
  });
});
