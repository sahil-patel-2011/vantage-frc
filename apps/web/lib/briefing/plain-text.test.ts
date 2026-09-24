import { describe, expect, it } from "vitest";
import { plainMatchKey, plainStrategyText, readablePlanChip } from "./plain-text";

describe("strategy text in a drive coach's words", () => {
  it("names matches the way people say them", () => {
    expect(plainMatchKey("2026gacmp_qm31")).toBe("Qual 31");
    expect(plainMatchKey("2026gacmp_sf2m1")).toBe("Semi 2-1");
    expect(plainMatchKey("not-a-key")).toBe("not-a-key");
  });

  it("rewrites engine evidence without changing its meaning", () => {
    expect(plainStrategyText("2026gacmp_qm31 BLUE playbook")).toBe("Qual 31 BLUE playbook");
    expect(plainStrategyText("MITIGATE match 2026gacmp_qm30 red leave-one-out 2481")).toBe(
      "Watch out: match Qual 30 red without that match 2481",
    );
    expect(plainStrategyText("frc118 auto solid, fouls 0.9/match")).toBe("Team 118 auto solid, fouls 0.9/match");
  });

  it("drops internal scout entry ids", () => {
    expect(plainStrategyText("Strong climber. Scout entries: 024959fe, d1d22fb0, 132b6aa1")).toBe("Strong climber.");
    expect(plainStrategyText("")).toBe("");
    expect(plainStrategyText(null)).toBe("");
  });
});

describe("engine evidence with bare entry ids", () => {
  it("drops '(entries …)' too", () => {
    expect(plainStrategyText("Scout auto capability ~74% (entries ba297aa2, 9201adc8, e0601f64). Next")).toBe(
      "Scout auto capability ~74%. Next",
    );
  });
});

describe("numbers people read", () => {
  it("rounds floating-point noise", () => {
    expect(plainStrategyText("Includes 61.099999999999994 org scout observations")).toBe("Includes 61.1 org scout observations");
    expect(plainStrategyText("Rating 12.000000001")).toBe("Rating 12");
    expect(plainStrategyText("fouls 0.9/match")).toBe("fouls 0.9/match");
  });
});

describe("rating words, not statistics words", () => {
  it("drops the repeated team number and says rating", () => {
    expect(
      plainStrategyText("Plan around Team 254 (#254) — Highest-EPA opponent at 59.2 (-6.6 vs our 65.8)"),
    ).toBe("Plan around Team 254 — Highest-rated opponent at 59.2 (-6.6 vs our 65.8)");
    expect(plainStrategyText("our EPA share")).toBe("our rating share");
  });

  it("keeps readable plan chips and drops engine ones", () => {
    expect(readablePlanChip("foul exposure")).toBe("foul exposure");
    expect(readablePlanChip("match 2026gacmp_qm30")).toBeNull();
    expect(readablePlanChip("red leave-one-out 67")).toBeNull();
    expect(readablePlanChip("")).toBeNull();
  });
});

describe("the prediction model's own words", () => {
  it("drops the engine's bookkeeping and says the rest plainly", () => {
    expect(plainStrategyText("MODEL output — not an official TBA result.")).toBe("");
    expect(plainStrategyText("Engine strategy-engine-max-v1 · depth 3 · Max (strategy-engine-max-v1).")).toBe("");
    expect(plainStrategyText("Includes 57 org scout observations as operational adjustments.")).toBe(
      "Uses 57 observations from our scouts.",
    );
    expect(plainStrategyText("8 FACT TBA match result(s) cited for alliance context.")).toBe("Uses 8 official match results.");
    expect(plainStrategyText("MODEL: Org scout foul penalty (capped) margin 0.7; not a TBA fact.")).toBe(
      "Our scouts' foul penalty margin 0.7",
    );
    expect(
      plainStrategyText("Alliance rating margin -17.1 from sources statbotics, event 2026gacmp, 58 weighted team-matches"),
    ).toBe("Alliance rating margin -17.1 from 58 matches of data");
    expect(plainStrategyText("Scout reliability 89% (n=7.6).")).toBe("Scout reliability 89%.");
    expect(plainStrategyText("Logistic win model on alliance rating margin -17.1 via engine strategy-engine-max-v1 (depth 3).")).toBe(
      "Logistic win model on alliance rating margin -17.1.",
    );
  });
});
