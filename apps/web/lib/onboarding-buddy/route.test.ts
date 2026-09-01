import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract for POST /api/onboarding-buddy create-pairing: both people must be
 * roster user ids. DEMO / free-text identities are rejected before a write.
 */
const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", async () => {
  const actual = await vi.importActual<typeof import("@vantage/core")>("@vantage/core");
  return {
    ...actual,
    auth: { api: { getSession: async () => state.session } },
  };
});

vi.mock("@vantage/db", () => ({
  withRls: async () => {
    throw new Error("create-pairing must reject invalid ids before withRls");
  },
}));

const { POST } = await import("../../app/api/onboarding-buddy/route");

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const NEW_MEMBER = "22222222-2222-4222-8222-222222222222";
const BUDDY = "33333333-3333-4333-8333-333333333333";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/onboarding-buddy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = null;
});

describe("POST /api/onboarding-buddy create-pairing", () => {
  it("returns 401 when there is no session", async () => {
    const response = await post({
      orgId: ORG,
      action: "create-pairing",
      newMemberId: NEW_MEMBER,
      buddyId: BUDDY,
    });
    expect(response.status).toBe(401);
  });

  it("rejects a DEMO network identity before writing", async () => {
    state.session = { user: { id: USER } };
    const response = await post({
      orgId: ORG,
      action: "create-pairing",
      newMemberId: "demo-user",
      buddyId: BUDDY,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "New member must be a roster member id" });
  });

  it("rejects a self-pair of the same roster user id", async () => {
    state.session = { user: { id: USER } };
    const response = await post({
      orgId: ORG,
      action: "create-pairing",
      newMemberId: NEW_MEMBER,
      buddyId: NEW_MEMBER,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A member cannot be their own buddy" });
  });
});
