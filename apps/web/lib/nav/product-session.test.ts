import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProductSession, invalidateProductSession, productSessionUrl } from "./product-session";

describe("productSessionUrl", () => {
  it("scopes the session to a team when one is known", () => {
    expect(productSessionUrl()).toBe("/api/me");
    expect(productSessionUrl(" org-1 ")).toBe("/api/me?orgId=org-1");
  });
});

describe("fetchProductSession", () => {
  afterEach(() => {
    invalidateProductSession();
    vi.unstubAllGlobals();
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
});
