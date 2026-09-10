import { describe, expect, it } from "vitest";
import {
  batteryCrumbs,
  batteryRunOkMessage,
  fmtWhen,
  healthBadge,
  healthStatusLabel,
  logKindLabel,
} from "./batteries-model";
import type { HealthStatus as LibHealth } from "../../lib/battery";

describe("batteries-model", () => {
  it("never grades an unmeasured pack as Good", () => {
    expect(healthBadge({ status: "good", score: null, reasons: [] })).toEqual({
      tone: "unmeasured",
      label: "Unknown",
    });
    const statuses: LibHealth[] = ["good", "aging", "retire"];
    expect(statuses.map(healthStatusLabel)).toEqual(["Good", "Aging", "Retire"]);
    expect(healthBadge({ status: "aging", score: 62, reasons: ["IR high"] }).label).toBe("Aging");
  });

  it("labels log kinds and timestamps without inventing activity", () => {
    expect(logKindLabel("resistance_test")).toBe("Resistance test");
    expect(logKindLabel("unknown-kind")).toBe("unknown-kind");
    expect(fmtWhen(null)).toBe("—");
    expect(fmtWhen("not-a-date")).toBe("—");
    expect(batteryCrumbs("build")).toBe("Build / Batteries");
    expect(batteryCrumbs(null)).toBe("Team / Batteries");
    expect(batteryRunOkMessage("create_pack")).toBe("Battery added.");
    expect(batteryRunOkMessage("other")).toBe("Updated.");
  });
});
