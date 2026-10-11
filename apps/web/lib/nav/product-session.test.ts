import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURE_API_TIMEOUT_MS } from "./resolve-org";
import { fetchProductSession, invalidateProductSession, productSessionUnreachable, productSessionUrl } from "./product-session";
import { requestMe } from "./me-request";

describe("productSessionUrl", () => {
  it("scopes the session to a team when one is known", () => {
    expect(productSessionUrl()).toBe("/api/me");
    expect(productSessionUrl(" org-1 ")).toBe("/api/me?orgId=org-1");
  });
});

describe("fetchProductSession", () => {
  it("follows the page's selected team unless explicitly requesting the default", async () => {
    vi.stubGlobal("window", { location: { search: "?orgId=team-b" } });
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchProductSession();
    await fetchProductSession(null);
    expect(fetchSpy.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "/api/me?orgId=team-b", "/api/me",
    ]);
  });

  afterEach(() => {
    invalidateProductSession();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dedupes concurrent /api/me reads for the same workspace", async () => {
    let starts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        starts += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ userId: "u1", orgId: "org-1" }),
        });
      }),
    );

    const [a, b] = await Promise.all([fetchProductSession("org-1"), fetchProductSession("org-1")]);
    expect(starts).toBe(1);
    expect(a?.orgId).toBe("org-1");
    expect(b?.orgId).toBe("org-1");
  });

  it("shares one /api/me request with requestMe callers on the same page", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ userId: "u1", orgId: "org-1" }) }));
    vi.stubGlobal("fetch", fetchSpy);
    const [shell, hook] = await Promise.all([fetchProductSession("org-1"), requestMe("org-1")]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(shell?.userId).toBe("u1");
    expect(hook.data).toEqual({ userId: "u1", orgId: "org-1" });
  });

  it("reads a 503 as unreachable, not signed out, and asks again next time", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "down" }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchProductSession("org-1")).resolves.toBeNull();
    expect(productSessionUnreachable()).toBe(true);
    invalidateProductSession();
    fetchSpy.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ userId: "u1" }) }));
    await expect(fetchProductSession("org-1")).resolves.toEqual({ userId: "u1" });
    expect(productSessionUnreachable()).toBe(false);
  });

  it("aborts hung /api/me reads so Home is not stuck waiting for a session", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ userId: "u1" }),
        }),
      ),
    );

    await fetchProductSession();
    expect(timeout).toHaveBeenCalledWith(FEATURE_API_TIMEOUT_MS);
  });

  it("clears the cache when the session fetch is aborted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))),
    );

    await expect(fetchProductSession()).resolves.toBeNull();
  });
});
