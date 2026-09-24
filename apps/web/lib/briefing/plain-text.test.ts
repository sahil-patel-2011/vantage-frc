import { describe, expect, it } from "vitest";
import { plainMatchKey, plainStrategyText } from "./plain-text";

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
