import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMe, requestMe } from "./me-request";

/**
 * The point of this module is that five callers produce one request. If the
 * coalescing quietly stops working nothing breaks visibly — the app just goes
 * back to seven `/api/me` round trips on a phone at a competition — so the
 * count is what these assert.
 */
function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl);
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

  it("forgetMe drops the shared answer", async () => {
    const fetchSpy = stubFetch(async () => okResponse({ orgId: "org-1" }));

    await requestMe();
    forgetMe();
    await requestMe();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
