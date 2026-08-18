import { describe, expect, it } from "vitest";
import { diagnoseWiring, looksLikePdhMainFeed, pdhMainFeedCue, WIRE_GAUGES } from ".";

describe("PDH main-feed 4 AWG cue (CD 2026 melted hubs)", () => {
  it("only flags a logged 4 AWG PDH/PDP main — never invents a gauge", () => {
    expect(WIRE_GAUGES).toContain("6");
    expect(WIRE_GAUGES).toContain("4");
    expect(looksLikePdhMainFeed("PDH main +")).toBe(true);
    expect(looksLikePdhMainFeed("Front Left Drive")).toBe(false);
    expect(pdhMainFeedCue("PDH main +", "6")).toBeNull();
    expect(pdhMainFeedCue("Front Left Drive", "4")).toBeNull();
    expect(pdhMainFeedCue("PDH main +", "4")).toMatch(/6 AWG/i);
    expect(pdhMainFeedCue("PDH main +", "4")?.toLowerCase()).not.toContain("demo");
  });

  it("surfaces the cue on a diagnosis without treating 6 AWG mains as undersized chassis wire", () => {
    const four = diagnoseWiring(
      [{ channel: 0, deviceName: "PDH main +", wireGauge: "4", breakerAmps: 120, expectedCurrentDrawAmps: 80 }],
      [{ channel: 0, deviceName: "PDH main +", wireGauge: "4", breakerAmps: 120 }],
    );
    expect(four.flags.some((flag) => flag.type === "pdh_4awg_feed")).toBe(true);
    expect(four.flags.some((flag) => flag.type === "wire_undersized_for_breaker")).toBe(false);

    const six = diagnoseWiring(
      [{ channel: 0, deviceName: "PDH main +", wireGauge: "6", breakerAmps: 120, expectedCurrentDrawAmps: 80 }],
      [{ channel: 0, deviceName: "PDH main +", wireGauge: "6", breakerAmps: 120 }],
    );
    expect(six.flags.some((flag) => flag.type === "pdh_4awg_feed")).toBe(false);
  });
});
