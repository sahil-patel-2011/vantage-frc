import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("My Hours API fixture / empty setup", () => {
  it("resolves the local fixture actor and returns setup_required instead of 401", () => {
    expect(SRC).toMatch(/resolveRequestActor/);
    expect(SRC).toMatch(/hoursSelfViewChooseTeamView/);
    expect(SRC).not.toMatch(/auth\.api\.getSession/);
    expect(SRC).not.toMatch(/status: 401/);
  });
});
