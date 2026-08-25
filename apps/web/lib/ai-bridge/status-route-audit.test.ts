import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Flipping a bridge device to coverage 'everything' points the whole team's AI at one
 * member's personal machine and personal subscription; revoking takes it back. Both are
 * org-security events, so PATCH must leave a row in `membership_audit_events` — and must
 * still succeed for a pairer whose role cannot insert one.
 */
const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const DEVICE = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params?: unknown[] }[],
  updateRowCount: 1,
  auditFails: false,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
    },
  },
}));

vi.mock("@vantage/agent", () => ({
  BRIDGE_ONLINE_WINDOW_MS: 180_000,
  BRIDGE_CHAT_FEATURES: ["chat"],
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params?: unknown[]) => {
        state.calls.push({ sql, params });
        if (sql.includes("membership_audit_events")) {
          // What RLS raises when the actor is the pairer but not an owner/admin.
          if (state.auditFails) throw new Error("new row violates row-level security policy");
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("UPDATE ai_bridge_devices")) {
          return {
            rows: state.updateRowCount ? [{ name: "Mentor desktop" }] : [],
            rowCount: state.updateRowCount,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

const { PATCH } = await import("../../app/api/ai-bridge/status/route");

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new Request(`https://vantage.test/api/ai-bridge/status?orgId=${ORG}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );

const auditCall = () => state.calls.find((call) => call.sql.includes("membership_audit_events"));

beforeEach(() => {
  state.calls = [];
  state.updateRowCount = 1;
  state.auditFails = false;
});

describe("PATCH /api/ai-bridge/status audit trail", () => {
  it("records who redirected the team's AI onto a personal subscription", async () => {
    const response = await patch({ deviceId: DEVICE, coverage: "everything" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, audited: true });

    const audit = auditCall();
    expect(audit?.params?.[0]).toBe(ORG);
    expect(audit?.params?.[1]).toBe(USER);
    expect(audit?.params?.[2]).toBe("ai_bridge.coverage.changed");
    expect(JSON.parse(String(audit?.params?.[3]))).toEqual({
      deviceId: DEVICE,
      deviceName: "Mentor desktop",
      coverage: "everything",
    });
  });

  it("records a revoked device", async () => {
    await patch({ deviceId: DEVICE, revoke: true });
    const audit = auditCall();
    expect(audit?.params?.[2]).toBe("ai_bridge.device.revoked");
    expect(JSON.parse(String(audit?.params?.[3]))).toEqual({
      deviceId: DEVICE,
      deviceName: "Mentor desktop",
    });
  });

  it("leaves the prefer-when-online toggle out of the audit stream", async () => {
    const response = await patch({ deviceId: DEVICE, preferWhenOnline: false });
    expect(await response.json()).toEqual({ success: true });
    expect(auditCall()).toBeUndefined();
  });

  it("keeps the device change when the audit row cannot be written", async () => {
    state.auditFails = true;
    const response = await patch({ deviceId: DEVICE, coverage: "everything" });
    expect(response.status).toBe(200);
    // Honest about the missing trail, and the savepoint keeps the UPDATE committed.
    expect(await response.json()).toEqual({ success: true, audited: false });
    expect(state.calls.map((call) => call.sql)).toContain("ROLLBACK TO SAVEPOINT ai_bridge_audit");
  });

  it("still 403s without auditing when the device is not the caller's to change", async () => {
    state.updateRowCount = 0;
    const response = await patch({ deviceId: DEVICE, coverage: "everything" });
    expect(response.status).toBe(403);
    expect(auditCall()).toBeUndefined();
  });

  it("still rejects an unknown coverage value before touching the database", async () => {
    const response = await patch({ deviceId: DEVICE, coverage: "all-of-it" });
    expect(response.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
