import { describe, expect, it } from "vitest";
import {
  INSPECTION_CHECK_SECTIONS,
  INITIAL_INSPECTION_FORM,
  WEIGHT_LIMIT_FIELD_LABEL,
  buildLogCheckPayload,
  canSubmitInspectionCheck,
  catalogCheckKeys,
  emptyWeightRow,
} from "./inspection-new-check-model";

describe("inspection new-check model", () => {
  it("keeps the default 115 yardstick honest until a team sets a limit", () => {
    expect(WEIGHT_LIMIT_FIELD_LABEL).toContain("default 115 until you set one");
    expect(INITIAL_INSPECTION_FORM.weightLimitLbs).toBe("115");
  });

  it("lists every checkbox once in the catalog", () => {
    const keys = catalogCheckKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("bumperEventRecorded");
    expect(keys).toContain("studentCaptainPresent");
    expect(keys).toContain("rslOnRioPort");
  });

  it("refuses submit until a named weigh-in row exists", () => {
    expect(canSubmitInspectionCheck(INITIAL_INSPECTION_FORM)).toBe(false);
    expect(
      canSubmitInspectionCheck({
        ...INITIAL_INSPECTION_FORM,
        robotName: "Competition Bot",
        weightItems: [{ name: "Chassis", weightLbs: "80" }],
      }),
    ).toBe(true);
    expect(
      canSubmitInspectionCheck({
        ...INITIAL_INSPECTION_FORM,
        robotName: "Competition Bot",
        weightItems: [emptyWeightRow()],
      }),
    ).toBe(false);
  });

  it("builds a log-check payload from logged limits and measurements", () => {
    const payload = buildLogCheckPayload({
      ...INITIAL_INSPECTION_FORM,
      robotName: "Competition Bot",
      weightItems: [{ name: "Chassis", weightLbs: "80" }, emptyWeightRow()],
      measuredPerimeterIn: "108",
      bumperEventRecorded: true,
      solidCoreFoam: true,
    });
    expect(payload.action).toBe("log-check");
    expect(payload.robotName).toBe("Competition Bot");
    const weight = payload.weightBudget as { limitLbs: number; items: Array<{ name: string }> };
    expect(weight.limitLbs).toBe(115);
    expect(weight.items).toEqual([{ name: "Chassis", weightLbs: 80 }]);
    const frame = payload.frameBumper as {
      measuredPerimeterIn: number;
      bumperEventRecorded: boolean;
      solidCoreFoam: boolean;
    };
    expect(frame.measuredPerimeterIn).toBe(108);
    expect(frame.bumperEventRecorded).toBe(true);
    expect(frame.solidCoreFoam).toBe(true);
    const wiring = payload.wiringPower as { mainBreakerMaxAmps: number; binderRecorded: boolean };
    expect(wiring.mainBreakerMaxAmps).toBe(120);
    expect(wiring.binderRecorded).toBe(false);
  });

  it("keeps gated sections behind a logged walk", () => {
    const bumper = INSPECTION_CHECK_SECTIONS.find((section) => section.id === "bumpers");
    expect(bumper?.gate).toBe("bumperEventRecorded");
    expect(bumper?.items[0]?.key).toBe("bumperEventRecorded");
  });
});
