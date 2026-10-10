import { describe, expect, it } from "vitest";
import { hubLegacyContextHref } from "./hub-legacy-context";

describe("hub redirects preserve the working context", () => {
  it("keeps event, report and repeated filters while choosing the resolved team", () => {
    const href = hubLegacyContextHref("/scouting/quality", "?tab=scout-crossval&orgId=old&eventKey=2026txho&report=abc&team=118&team=254", "current");
    const url = new URL(href, "https://vantage.example");
    expect(url.pathname).toBe("/scouting/quality");
    expect(url.searchParams.get("orgId")).toBe("current");
    expect(url.searchParams.get("eventKey")).toBe("2026txho");
    expect(url.searchParams.get("report")).toBe("abc");
    expect(url.searchParams.getAll("team")).toEqual(["118", "254"]);
    expect(url.searchParams.has("tab")).toBe(false);
  });
  it("keeps a destination's mode and anchor, and removes a stale team without a resolved team", () => {
    expect(hubLegacyContextHref("/strategy?tab=picks#saved", "?tab=strategy&orgId=old&eventKey=2026txho", null))
      .toBe("/strategy?tab=picks&eventKey=2026txho#saved");
  });
});
