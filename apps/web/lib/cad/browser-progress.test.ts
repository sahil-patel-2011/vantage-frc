import { describe, expect, it } from "vitest";
import { browserActionProgress } from "./browser-progress";

describe("browser CAD uncertain-action recovery", () => {
  it("pauses an unconfirmed action instead of allowing the next automatic step", () => {
    for (const result of [null, {}, { actionPerformed: false, verification: "none", status: "unverified" }]) {
      expect(browserActionProgress(result, false).pause).toBe(true);
    }
  });
  it("pauses when a requested postcondition was not observed", () => {
    expect(browserActionProgress({ actionPerformed: true, verification: "none", status: "unverified" }, true).pause).toBe(true);
  });
  it("preserves an explicit popup inspection warning even when its click was performed", () => {
    expect(browserActionProgress({ actionPerformed: true, status: "unverified", verification: "none", requiresInspection: true, message: "A new tab opened. Inspect it before continuing." }, false)).toEqual({ pause: true, message: "A new tab opened. Inspect it before continuing." });
  });
  it("can continue ordinary confirmed input without claiming geometric verification", () => {
    const result = browserActionProgress({ actionPerformed: true, verification: "none", status: "unverified" }, false);
    expect(result.pause).toBe(false);
    expect(result.message).toContain("still needs verification");
  });
  it("distinguishes a successful UI check from geometry and rejects contradictory flags", () => {
    expect(browserActionProgress({ actionPerformed: true, verification: "ui-postcondition", status: "verified" }, true)).toEqual({ pause: false, message: "UI check passed. Geometry still requires measurement." });
    expect(browserActionProgress({ actionPerformed: false, verification: "ui-postcondition", status: "verified" }, true).message).not.toContain("passed");
  });
});
