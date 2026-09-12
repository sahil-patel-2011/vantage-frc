import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Sponsor CRM / Sponsor Suite / Sponsor Wall related-strip
 * labels after leftover-related-more. Hub labels stay Sponsors, Sponsor
 * suite, and Sponsor wall. leftover-business-titles Award tracker family,
 * leftover-business-more Eligibility / Renewal ROI / Open Impact,
 * leftover-people-more Matching gifts, leftover-community-impact Impact,
 * leftover-hub-strips Open Media kit, leftover-pick-before Choose your
 * team stay. Hub My Day / Schema A/B stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "lib/matching-gift-finder/matching-gift-finder-related.ts",
  "app/matching-gift-finder/matching-gift-finder-client.tsx",
  "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts",
  "app/sponsor-renewal-roi/sponsor-renewal-roi-client.tsx",
  "lib/sponsor-wall/sponsor-wall-related.ts",
  "app/sponsor-wall/sponsor-wall-client.tsx",
  "lib/sponsor-suite/sponsor-suite-related.ts",
  "app/sponsor-suite/sponsor-suite-client.tsx",
  "lib/media-kit/media-kit-related.ts",
  "app/business/sponsor-pipeline-panel.tsx",
] as const;

describe("leftover student sponsor-more chrome", () => {
  it("does not print leftover Sponsor CRM / Suite / Wall titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Open Sponsor CRM/);
      expect(src, rel).not.toMatch(/Open Sponsor Suite/);
      expect(src, rel).not.toMatch(/Open Sponsor Wall/);
      expect(src, rel).not.toMatch(/label: "Sponsor CRM"/);
      expect(src, rel).not.toMatch(/label: "Sponsor Suite"/);
      expect(src, rel).not.toMatch(/label: "Sponsor Wall"/);
      expect(src, rel).not.toMatch(/Sponsor CRM/);
      expect(src, rel).not.toMatch(/Sponsor Suite/);
      expect(src, rel).not.toMatch(/Sponsor Wall/);
    }
    const gifts = readFileSync(
      join(WEB, "lib/matching-gift-finder/matching-gift-finder-related.ts"),
      "utf8",
    );
    expect(gifts).toMatch(/Open Sponsors/);
    expect(gifts).toMatch(/Open Renewal ROI/);
    expect(gifts).toMatch(/Matching gifts/);
    expect(gifts).toMatch(/Choose your team/);
    expect(gifts).not.toMatch(/\bPick a team\b/);
    const giftsClient = readFileSync(
      join(WEB, "app/matching-gift-finder/matching-gift-finder-client.tsx"),
      "utf8",
    );
    expect(giftsClient).toMatch(/title="Matching gifts"/);
    expect(giftsClient).toMatch(/Cross-check Sponsors/);
    const renewal = readFileSync(
      join(WEB, "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts"),
      "utf8",
    );
    expect(renewal).toMatch(/Open Sponsors/);
    expect(renewal).toMatch(/Open Sponsor suite/);
    expect(renewal).toMatch(/Open Sponsor wall/);
    expect(renewal).toMatch(/Open Impact/);
    expect(renewal).toMatch(/Opening Renewal ROI/);
    expect(renewal).toMatch(/Choose your team/);
    expect(renewal).not.toMatch(/title="Loading/);
    expect(renewal).not.toMatch(/\bPick a team\b/);
    const renewalClient = readFileSync(
      join(WEB, "app/sponsor-renewal-roi/sponsor-renewal-roi-client.tsx"),
      "utf8",
    );
    expect(renewalClient).toMatch(/title="Renewal ROI"/);
    expect(renewalClient).toMatch(/Cross-check Sponsors/);
    const suite = readFileSync(join(WEB, "lib/sponsor-suite/sponsor-suite-related.ts"), "utf8");
    expect(suite).toMatch(/Open Sponsors/);
    expect(suite).toMatch(/label: "Sponsors"/);
    const suiteClient = readFileSync(
      join(WEB, "app/sponsor-suite/sponsor-suite-client.tsx"),
      "utf8",
    );
    expect(suiteClient).toMatch(/title="Sponsor suite"/);
    expect(suiteClient).toMatch(/feature="Sponsor suite"/);
    expect(suiteClient).toMatch(/Open Sponsors/);
    const wall = readFileSync(join(WEB, "lib/sponsor-wall/sponsor-wall-related.ts"), "utf8");
    expect(wall).toMatch(/Open Sponsors/);
    expect(wall).toMatch(/label: "Sponsors"/);
    const wallClient = readFileSync(join(WEB, "app/sponsor-wall/sponsor-wall-client.tsx"), "utf8");
    expect(wallClient).toMatch(/title="Sponsor wall"/);
    expect(wallClient).toMatch(/feature="Sponsor wall"/);
    expect(wallClient).toMatch(/Open Sponsors/);
    const mediaKit = readFileSync(join(WEB, "lib/media-kit/media-kit-related.ts"), "utf8");
    expect(mediaKit).toMatch(/label: "Sponsors"/);
    expect(mediaKit).toMatch(/Opening Media kit/);
    expect(mediaKit).toMatch(/Choose your team/);
    const pipeline = readFileSync(join(WEB, "app/business/sponsor-pipeline-panel.tsx"), "utf8");
    expect(pipeline).toMatch(/Sponsor suite →/);
  });
});
