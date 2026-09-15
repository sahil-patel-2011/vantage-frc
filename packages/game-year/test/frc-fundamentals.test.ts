import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRC_OFFICIAL_SOURCES,
  currentSeasonYear,
  frcFundamentals,
  packForYear,
} from "../src";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const SKILL_PATHS = [
  ".agents/skills/frc-fundamentals/SKILL.md",
  ".cursor/skills/frc-fundamentals/SKILL.md",
  ".claude/skills/frc-fundamentals/SKILL.md",
] as const;

describe("frcFundamentals", () => {
  it("grounds 2026 REBUILT in the published pack without inventing point values", () => {
    const facts = frcFundamentals(2026);
    const pack = packForYear(2026);
    expect(facts.currentGame.gameName).toBe("REBUILT");
    expect(facts.currentGame.status).toBe("published");
    expect(facts.currentGame.scoringKeys).toEqual(pack.scoringKeys);
    expect(facts.currentGame.scoringLabels).toEqual(
      expect.arrayContaining(["Auto fuel scored", "Teleop fuel scored", "Tower climb"]),
    );
    expect(facts.disclaimer).toMatch(/Do not invent/i);
    expect(JSON.stringify(facts)).not.toMatch(/\b\d+\s*points?\b/i);
  });

  it("does not invent 2027 BIOCORE scoring; points at last published REBUILT", () => {
    const facts = frcFundamentals(2027);
    expect(facts.currentGame.gameName).toBe("BIOCORE");
    expect(facts.currentGame.status).toBe("awaiting_manual");
    expect(facts.currentGame.scoringKeys).toEqual([]);
    expect(facts.currentGame.lastPublished).toEqual(
      expect.objectContaining({ year: 2026, gameName: "REBUILT", status: "published" }),
    );
  });

  it("lists only FIRST and WPILib official source URLs", () => {
    expect(FRC_OFFICIAL_SOURCES.length).toBeGreaterThan(0);
    for (const source of FRC_OFFICIAL_SOURCES) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(["www.firstinspires.org", "docs.wpilib.org"]).toContain(url.hostname);
    }
    const facts = frcFundamentals(currentSeasonYear(new Date("2026-03-01T12:00:00Z")));
    expect(facts.sources).toEqual(FRC_OFFICIAL_SOURCES);
    expect(facts.vantage.map((row) => row.area).sort()).toEqual(["cad", "code", "scouting"]);
  });
});

describe("FRC skill on disk", () => {
  it("ships identical Cursor/Claude skills that match the pack and official URLs", () => {
    const bodies = SKILL_PATHS.map((relative) => readFileSync(join(repoRoot, relative), "utf8"));
    expect(new Set(bodies).size).toBe(1);
    const skill = bodies[0]!;
    expect(skill).toMatch(/^---\nname: frc-fundamentals\n/);
    expect(skill).toContain("https://www.firstinspires.org/robotics/frc");
    expect(skill).toContain("https://www.firstinspires.org/resource-library/frc/competition-manual-qa-system");
    expect(skill).toContain("https://docs.wpilib.org/en/stable/");
    expect(skill).toContain("REBUILT");
    expect(skill).toContain("frc.fundamentals");
    expect(skill).toMatch(/Do not copy/i);
    expect(skill).not.toMatch(/\b\d+\s*points?\b/i);
  });
});
