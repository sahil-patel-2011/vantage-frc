import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeGameBrief } from "../game-brief/compute-game-brief";

const WEB = join(__dirname, "..", "..");

describe("Kickoff game brief student chrome", () => {
  it("paints one Ask about this game primary and Needs setup on no team", () => {
    const client = readFileSync(join(WEB, "app/kickoff/kickoff-client.tsx"), "utf8");
    const brief = readFileSync(join(WEB, "app/kickoff/kickoff-game-brief.tsx"), "utf8");
    expect(client).toMatch(/Needs setup/);
    expect(client).not.toMatch(/Setup required/);
    expect(client).toMatch(/GameBriefSection/);
    expect(brief).toMatch(/Ask about this game/);
    expect(brief).toMatch(/gameAskHref/);
    expect(brief).toMatch(/gameBriefStatusBadge/);
    expect(brief).not.toMatch(/Needs setup/);
    expect(brief.match(/<Button\b/g) ?? []).toHaveLength(1);
    expect(brief).toMatch(/variant="primary"/);
    expect(computeGameBrief(2026).scoringLabels.length).toBeGreaterThan(0);
    expect(computeGameBrief(2027).priorSeason?.year).toBe(2026);
  });
});
