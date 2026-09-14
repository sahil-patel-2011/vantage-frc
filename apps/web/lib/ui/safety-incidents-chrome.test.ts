import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Safety / incidents student boards this week: Needs setup, one primary,
 * last snapshot. Related stays in the header. Not packing / hours / pick-desk.
 */
const FILES = [
  "app/safety/safety-client.tsx",
  "app/incidents/incidents-client.tsx",
  "app/safety-training/safety-training-client.tsx",
  "app/incident-heatmap/incident-heatmap-client.tsx",
] as const;

describe("safety / incidents student chrome", () => {
  it("does not print Setup required / VANTAGE / primary-action on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
  });

  it("setup keeps Needs setup and one Choose your team primary", () => {
    const safety = readFileSync(join(WEB, "app/safety/safety-client.tsx"), "utf8");
    expect(safety).toMatch(/badge="Needs setup"/);
    expect(safety).toMatch(/title="Choose your team"/);
    expect(safety).toMatch(/href="\/workspace"/);
    expect(safety).toMatch(/Safety incidents/);
    expect(safety).toMatch(/Safety training/);
    expectPlainCopy("Incidents, near-misses, and who is cleared on which tools.");

    const incidents = readFileSync(join(WEB, "app/incidents/incidents-client.tsx"), "utf8");
    expect(incidents).toMatch(/badge="Needs setup"/);
    expect(incidents).toMatch(/title="Choose your team"/);
    expect(incidents).toMatch(/view\.steps\[0\]/);
    expect(incidents).toMatch(/Safety training/);

    const training = readFileSync(join(WEB, "app/safety-training/safety-training-client.tsx"), "utf8");
    expect(training).toMatch(/badge="Needs setup"/);
    expect(training).toMatch(/title="Choose your team"/);
    expect(training).toMatch(/Safety incidents/);
    expect(training).toMatch(/view\.steps\[0\]/);

    const heatmap = readFileSync(join(WEB, "app/incident-heatmap/incident-heatmap-client.tsx"), "utf8");
    expect(heatmap).toMatch(/badge="Needs setup"/);
    expect(heatmap).toMatch(/title="Choose your team"/);
    expect(heatmap).toMatch(/view\.steps\[0\]/);
    expect(heatmap).toMatch(/Failure patterns/);
  });

  it("gold last-snapshot does not blank a painted board", () => {
    const safety = readFileSync(join(WEB, "app/safety/safety-client.tsx"), "utf8");
    expect(safety).toMatch(/getFeatureSnapshot/);
    expect(safety).toMatch(/putFeatureSnapshot/);
    expect(safety).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(safety).toMatch(/if \(!view\)/);
    expect(safety).not.toMatch(/fetchFailed \|\| !view/);

    const incidents = readFileSync(join(WEB, "app/incidents/incidents-client.tsx"), "utf8");
    expect(incidents).toMatch(/getFeatureSnapshot/);
    expect(incidents).toMatch(/"incidents"/);
    expect(incidents).toMatch(/if \(!view\)/);
    expect(incidents).toMatch(/response\.status === 401 \|\| response\.status === 403/);

    const training = readFileSync(join(WEB, "app/safety-training/safety-training-client.tsx"), "utf8");
    expect(training).toMatch(/getFeatureSnapshot/);
    expect(training).toMatch(/"safety-training"/);
    expect(training).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(training).not.toMatch(/fetchFailed \|\| !view/);

    const heatmap = readFileSync(join(WEB, "app/incident-heatmap/incident-heatmap-client.tsx"), "utf8");
    expect(heatmap).toMatch(/getFeatureSnapshot/);
    expect(heatmap).toMatch(/"incident-heatmap"/);
    expect(heatmap).toMatch(/if \(!view\)/);
    expect(heatmap).toMatch(/response\.status === 401 \|\| response\.status === 403/);
  });
});
