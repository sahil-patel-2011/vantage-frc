import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMe, meRetryDelayMs, requestMe } from "./me-request";

/**
 * The point of this module is that five callers produce one request. If the
 * coalescing quietly stops working nothing breaks visibly — the app just goes
 * back to seven `/api/me` round trips on a phone at a competition — so the
 * count is what these assert.
 */
function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn<typeof fetch>(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

beforeEach(() => {
  forgetMe();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  forgetMe();
});

describe("requestMe", () => {
  it("keeps each selected team's session separate", async () => {
    const location = { search: "?orgId=team-a" };
    vi.stubGlobal("window", { location });
    const fetchSpy = stubFetch(async () => okResponse({}));
    await requestMe();
    location.search = "?orgId=team-b";
    await requestMe();
    expect(fetchSpy.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "/api/me?orgId=team-a", "/api/me?orgId=team-b",
    ]);
  });

  it("never shares permission answers between selected teams", async () => {
    const fetchSpy = stubFetch(async () => okResponse({ hubAccess: [] }));
    await Promise.all([requestMe("team-a"), requestMe("team-b"), requestMe("team-a")]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(call => call[0])).toEqual(["/api/me?orgId=team-a", "/api/me?orgId=team-b"]);
  });

  it("does not recache an old person's pending answer after the session is forgotten", async () => {
    let finishOld!: (response: Response) => void;
    const fetchSpy = stubFetch(() => new Promise(resolve => { finishOld = resolve; }));
    const old = requestMe("team-a");
    forgetMe();
    fetchSpy.mockImplementation(async () => okResponse({ userId: "new-person" }));
    expect((await requestMe("team-a")).data).toEqual({ userId: "new-person" });
    finishOld(okResponse({ userId: "old-person" }));
    await old;
    expect((await requestMe("team-a")).data).toEqual({ userId: "new-person" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it("makes one request for callers that ask at the same time", async () => {
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));

    const results = await Promise.all([requestMe(), requestMe(), requestMe()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toEqual({ ok: true, status: 200, data: { orgId: "org-1" } });
    }
  });

  it("makes one request for a caller that arrives just after the first finished", async () => {
    // React's development double-effect remounts rather than overlapping, so
    // the second read starts after the first settled. Coalescing in-flight
    // requests alone would miss it; the freshness window is what catches it.
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));

    await requestMe();
    await requestMe();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("asks again once the answer is no longer fresh", async () => {
    vi.useFakeTimers();
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));

    await requestMe();
    vi.advanceTimersByTime(2_001);
    await requestMe();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports a refused response without a body", async () => {
    stubFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response);

    expect(await requestMe()).toEqual({ ok: false, status: 401, data: null });
  });

  it("reports a request that never got a reply as status 0", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });

    expect(await requestMe()).toEqual({ ok: false, status: 0, data: null });
  });

  it("does not wedge on a failure — the next call tries again", async () => {
    let attempt = 0;
    const fetchSpy = stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("offline");
      return okResponse({ orgId: "org-1" });
    });

    vi.useFakeTimers();
    expect((await requestMe()).ok).toBe(false);
    vi.advanceTimersByTime(2_001);
    expect((await requestMe()).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));
    for (let i = 0; i < 25; i += 1) expect(await requestMe("org-1")).toEqual({ ok: false, status: 0, data: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("spaces out retries after unanswered reads, then asks at once when back online", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", {
      location: { search: "" },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    });
    const fetchSpy = stubFetch(async () => {
      throw new Error("offline");
    });
    // Twenty seconds of a page asking every 800ms: 2s, 4s, 8s waits, not 25 requests.
    for (let elapsed = 0; elapsed <= 20_000; elapsed += 800) {
      await requestMe("org-1");
      vi.advanceTimersByTime(800);
    }
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    fetchSpy.mockImplementation(async () => okResponse({ orgId: "org-1" }));
    listeners.get("online")?.();
    expect(await requestMe("org-1")).toEqual({ ok: true, status: 200, data: { orgId: "org-1" } });
  });

  it("backs off after a server outage (5xx) but not after a definite answer", async () => {
    vi.useFakeTimers();
    let status = 503;
    const fetchSpy = stubFetch(async () => ({ ok: status < 300, status, json: async () => ({}) }) as unknown as Response);
    await requestMe("org-1");
    vi.advanceTimersByTime(2_001);
    await requestMe("org-1");
    vi.advanceTimersByTime(2_001);
    await requestMe("org-1");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(meRetryDelayMs(1)).toBe(2_000);
    expect(meRetryDelayMs(2)).toBe(4_000);
    expect(meRetryDelayMs(10)).toBe(30_000);

    forgetMe();
    status = 401;
    fetchSpy.mockClear();
    await requestMe("org-1");
    vi.advanceTimersByTime(2_001);
    await requestMe("org-1");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("forgetMe drops the shared answer", async () => {
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));

    await requestMe();
    forgetMe();
    await requestMe();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
