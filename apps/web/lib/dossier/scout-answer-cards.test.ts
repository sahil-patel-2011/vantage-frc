import { describe, expect, it } from "vitest";
import { scoutAnswerCards } from "./scout-answer-cards";

describe("scoutAnswerCards", () => {
  it("omits cards when payloads are empty", () => {
    expect(scoutAnswerCards("frc1", [])).toEqual([]);
    expect(
      scoutAnswerCards("frc1", [{ entryType: "match", payload: {} }, { entryType: "pit", payload: {} }]),
    ).toEqual([]);
  });

  it("shows logged match and pit answers and skips missing keys", () => {
    const cards = scoutAnswerCards("frc1", [
      {
        entryType: "pit",
        payload: { drivetrain_type: "swerve", programming_language: "java", trench: true },
      },
      {
        entryType: "match",
        payload: { auto_fuel: 4, teleop_fuel: 10, tower_level: "L2", driver_ability: 4 },
      },
    ]);
    expect(cards.map((card) => card.id)).toEqual([
      "scout-drivetrain",
      "scout-language",
      "scout-pit-trench",
      "scout-auto-fuel",
      "scout-teleop-fuel",
      "scout-tower",
      "scout-driver",
    ]);
    expect(cards.find((card) => card.id === "scout-drivetrain")?.value).toBe("swerve");
    expect(cards.find((card) => card.id === "scout-auto-fuel")?.value).toBe("4");
    expect(cards.every((card) => card.category === "scout")).toBe(true);
    expect(JSON.stringify(cards)).not.toMatch(/DEMO/i);
  });
});
