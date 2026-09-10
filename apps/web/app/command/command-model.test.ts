import { describe, expect, it } from "vitest";
import { commandHrefsFromSnap, pct, teamLabel } from "./command-model";

describe("command-model", () => {
  it("formats win probability without inventing a match", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0.64)).toBe("64%");
  });

  it("labels TBA team keys from real keys or numbers", () => {
    expect(teamLabel("frc6925")).toBe("6925");
    expect(teamLabel("frc1", 1)).toBe("1");
  });

  it("builds competition hrefs from the snapshot without DEMO paths", () => {
    const hrefs = commandHrefsFromSnap(null, "org-1");
    expect(hrefs.schedule).toBe("/schedule?orgId=org-1");
    expect(hrefs.myDay).toBe("/competition?tab=my-day&orgId=org-1");
    expect(JSON.stringify(hrefs)).not.toMatch(/\/demo/i);
  });
});
