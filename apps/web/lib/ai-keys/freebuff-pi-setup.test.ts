import { describe, expect, it } from "vitest";
import {
  FREEBUFF_PI_SETUP_INTRO,
  FREEBUFF_PI_SETUP_STEPS,
  NORMAL_TEAM_AI_PATH,
} from "./freebuff-pi-setup";

describe("Freebuff Pi setup copy", () => {
  it("walks granted teams through an account and their own Pi", () => {
    expect(FREEBUFF_PI_SETUP_STEPS.map((step) => step.id)).toEqual([
      "account",
      "coder-ui",
      "own-pi",
      "folders",
    ]);
    expect(FREEBUFF_PI_SETUP_STEPS[0]?.href).toMatch(/freebuff\.com/);
    expect(FREEBUFF_PI_SETUP_INTRO).toMatch(/selected teams/i);
    expect(FREEBUFF_PI_SETUP_STEPS.find((step) => step.id === "coder-ui")?.detail).toMatch(/npx --yes @codebuff\/cli login/);
    expect(FREEBUFF_PI_SETUP_STEPS.find((step) => step.id === "own-pi")?.detail).toMatch(/shut the laptop|power off the laptop/i);
    expect(FREEBUFF_PI_SETUP_INTRO).toMatch(/frcvantagefreebuff relay/);
    expect(FREEBUFF_PI_SETUP_INTRO).toMatch(/API keys or the credits/i);
  });

  it("does not promise Freebuff to teams without a grant", () => {
    expect(NORMAL_TEAM_AI_PATH).toMatch(/without a Free AI grant/i);
    expect(NORMAL_TEAM_AI_PATH).not.toMatch(/unlimited for every team/i);
  });
});
