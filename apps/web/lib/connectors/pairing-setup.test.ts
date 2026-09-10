import { describe, expect, it } from "vitest";
import {
  RELAY_DB_ENV,
  RELAY_DB_SETUP_MESSAGE,
  isRelayDatabaseUnconfigured,
  relaySetupResponse,
} from "./pairing-setup";
import { connectorById, describeConnector } from "./catalog";

describe("a pairing endpoint tells a machine agent the truth about a setup problem", () => {
  it("recognises the relay pool refusing to build for want of its connection string", () => {
    expect(isRelayDatabaseUnconfigured(new Error("DATABASE_CAD_RELAY_URL is required"))).toBe(true);
  });

  it("does not mistake a real database failure for a setup problem", () => {
    expect(isRelayDatabaseUnconfigured(new Error("connection terminated unexpectedly"))).toBe(false);
    expect(isRelayDatabaseUnconfigured(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(isRelayDatabaseUnconfigured(null)).toBe(false);
    expect(isRelayDatabaseUnconfigured(undefined)).toBe(false);
  });

  it("answers 503, not 400 — a 400 tells the node agent it sent something wrong and it stops", async () => {
    const response = relaySetupResponse();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; missingEnv: string[] };
    expect(body.missingEnv).toEqual([RELAY_DB_ENV]);
  });

  it("names the variable, where it goes, and what it may be set to", () => {
    expect(RELAY_DB_SETUP_MESSAGE).toContain("DATABASE_CAD_RELAY_URL");
    expect(RELAY_DB_SETUP_MESSAGE).toContain("Environment Variables");
    expect(RELAY_DB_SETUP_MESSAGE).toContain("vantage_pairing");
    expect(RELAY_DB_SETUP_MESSAGE).toContain("DATABASE_URL");
  });

  it("says there is no callback URL and no third-party account, the questions the OAuth connectors train people to ask", () => {
    expect(RELAY_DB_SETUP_MESSAGE).toMatch(/no callback URL/i);
    expect(RELAY_DB_SETUP_MESSAGE).toMatch(/Autodesk/i);
  });
});

describe("the pairing connectors on the settings page", () => {
  it("tells a storage node reader where the pairing code comes from", () => {
    const status = describeConnector(connectorById("storage-node"), {});
    expect(status.detail).toMatch(/storage-node agent/i);
    expect(status.permissions.join(" ")).toMatch(/pairing code/i);
  });

  it("says Fusion is local by design rather than implying a missing cloud integration", () => {
    const status = describeConnector(connectorById("fusion-relay"), {});
    expect(status.powers).toMatch(/no cloud API/i);
    expect(status.statusLine).toBe("Not configured — set FUSION_RELAY_SIGNING_SECRET");
  });

  it("reports a paired node as Connected by its own name, from a real row only", () => {
    const status = describeConnector(connectorById("storage-node"), {}, {
      linked: true,
      account: "shop-pi",
      note: "Paired and last heard from at 2026-09-09T20:00:00Z.",
    });
    expect(status.statusLine).toBe("Connected as shop-pi");
    expect(status.detail).toContain("last heard from");
  });

  it("does not call a node Connected just because it was paired and never checked in", () => {
    // The note carries the truth; the badge stays Connected because the pairing
    // row is real, and the detail is what says the agent is not running.
    const status = describeConnector(connectorById("storage-node"), {}, {
      linked: true,
      account: "shop-pi",
      note: "Paired, but it has never sent a heartbeat — check that the node agent is running on the team machine.",
    });
    expect(status.detail).toMatch(/never sent a heartbeat/);
  });
});
