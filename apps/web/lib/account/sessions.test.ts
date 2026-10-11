import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeUserAgent, sessionViews } from "./sessions";

const NOW = Date.parse("2026-10-11T12:00:00Z");

describe("describing a session's device", () => {
  it("names browser and system in plain words", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(describeUserAgent("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome on Chromebook");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(describeUserAgent(null)).toBe("An unknown browser");
  });
});

describe("the sessions list", () => {
  const rows = [
    { id: "old", userAgent: "Firefox/131.0 (Macintosh)", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z", expiresAt: "2026-10-12T00:00:00Z", token: "secret-1" },
    { id: "here", userAgent: "Chrome/141.0 (Windows)", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", expiresAt: "2026-10-18T00:00:00Z", token: "secret-2" },
    { id: "gone", userAgent: "Chrome/141.0 (Android)", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", expiresAt: "2026-09-08T00:00:00Z", token: "secret-3" },
  ];

  it("lists live sessions, this one first, and never a token", () => {
    const views = sessionViews(rows, "here", NOW);
    expect(views.map((view) => view.id)).toEqual(["here", "old"]);
    expect(views[0]?.current).toBe(true);
    expect(JSON.stringify(views)).not.toMatch(/secret/);
  });
});

const fake = vi.hoisted(() => ({
  session: null as null | { user: { id: string }; session: { id: string } },
  rows: [] as Array<Record<string, unknown>>,
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: async () => fake.session,
      revokeSession: fake.revokeSession,
      revokeOtherSessions: fake.revokeOtherSessions,
    },
    $context: Promise.resolve({ internalAdapter: { listSessions: async () => fake.rows } }),
  },
}));

function post(body: unknown) {
  return new Request("https://vantage.example/api/account/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: "https://vantage.example" },
    body: JSON.stringify(body),
  });
}

describe("/api/account/sessions", () => {
  beforeEach(() => {
    fake.session = { user: { id: "user-1" }, session: { id: "here" } };
    fake.rows = [
      { id: "here", userId: "user-1", token: "t-here", userAgent: "Chrome/141.0 (Windows)", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", expiresAt: "2999-01-01T00:00:00Z" },
      { id: "phone", userId: "user-1", token: "t-phone", userAgent: "Safari/604.1 Version/18.0 (iPhone)", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", expiresAt: "2999-01-01T00:00:00Z" },
    ];
    fake.revokeSession.mockReset();
    fake.revokeOtherSessions.mockReset();
  });

  it("lists this person's sessions without tokens", async () => {
    const { GET } = await import("../../app/api/account/sessions/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/t-here|t-phone/);
    expect(JSON.parse(text).sessions.map((session: { id: string }) => session.id)).toEqual(["here", "phone"]);
  });

  it("refuses a signed-out caller", async () => {
    fake.session = null;
    const { GET } = await import("../../app/api/account/sessions/route");
    expect((await GET()).status).toBe(401);
  });

  it("signs out one other session by id, using its token on the server only", async () => {
    const { POST } = await import("../../app/api/account/sessions/route");
    const response = await POST(post({ action: "revoke", id: "phone" }));
    expect(response.status).toBe(200);
    expect(fake.revokeSession).toHaveBeenCalledWith(expect.objectContaining({ body: { token: "t-phone" } }));
  });

  it("will not end the current session from here (that is Sign out)", async () => {
    const { POST } = await import("../../app/api/account/sessions/route");
    const response = await POST(post({ action: "revoke", id: "here" }));
    expect(response.status).toBe(400);
    expect(fake.revokeSession).not.toHaveBeenCalled();
  });

  it("signs out every other session", async () => {
    const { POST } = await import("../../app/api/account/sessions/route");
    expect((await POST(post({ action: "revoke-others" }))).status).toBe(200);
    expect(fake.revokeOtherSessions).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-site request", async () => {
    const { POST } = await import("../../app/api/account/sessions/route");
    const request = new Request("https://vantage.example/api/account/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ action: "revoke-others" }),
    });
    expect((await POST(request)).status).toBe(403);
    expect(fake.revokeOtherSessions).not.toHaveBeenCalled();
  });
});
