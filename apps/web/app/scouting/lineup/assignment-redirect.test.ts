import { describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ redirect: vi.fn((href: string) => { throw new Error(`Redirect: ${href}`); }) }));
vi.mock("next/navigation", () => navigation);
import ScoutingLineupPage from "./page";

describe("legacy assignment links", () => {
  it("preserves team, event, focus and repeated filter values at one destination", async () => {
    await expect(ScoutingLineupPage({ searchParams: Promise.resolve({ orgId: "team", eventKey: "2026test", matchKey: "2026test_qm12", qualsOnly: "0", tag: ["a", "b"] }) })).rejects.toThrow("Redirect:");
    const url = new URL(navigation.redirect.mock.calls[0]![0], "https://vantage.example");
    expect(url.pathname).toBe("/scout-coverage-live");
    expect(url.searchParams.get("orgId")).toBe("team");
    expect(url.searchParams.get("eventKey")).toBe("2026test");
    expect(url.searchParams.get("matchKey")).toBe("2026test_qm12");
    expect(url.searchParams.get("qualsOnly")).toBe("0");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
  });
});
