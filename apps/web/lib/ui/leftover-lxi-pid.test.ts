import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_LIMIT_TUNING_CUE, TUNING_CATEGORY_LABEL } from "../tuning";
import { tuningControllerTypeLabel } from "../tuning-autopilot";
import { formatLikelihoodImpact } from "../risks/risks-related";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student L×I / PID chrome on Risks, Risk burndown, Failure log
 * battery signals, and Tuning. Identifiers `pid` / `pidf` / `feedforward`
 * and comments on related helpers stay. Do not source-scan files whose
 * comments still say L×I / PID / FMEA. Do not invent a last-snapshot.
 */
const FILES = [
  "app/risks/risks-client.tsx",
  "app/risk-burndown/risk-burndown-client.tsx",
  "app/fmea/fmea-client.tsx",
  "app/tuning-autopilot/tuning-autopilot-client.tsx",
  "app/tuning/tuning-client.tsx",
  "app/code-perf/code-perf-client.tsx",
  "lib/help/section-help.ts",
  "lib/risk-burndown/compute-risk-burndown.ts",
  "lib/manifests/tuning-autopilot.manifest.ts",
  "lib/dev-setup/track.ts",
] as const;

describe("leftover student L×I / PID chrome", () => {
  it("does not print leftover L×I or PID phrases on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/L×I/);
      expect(src, rel).not.toMatch(/L\d+\s*×\s*I\d+/);
      expect(src, rel).not.toMatch(/PID\/feedforward/);
      expect(src, rel).not.toMatch(/PID gain/);
      expect(src, rel).not.toMatch(/likelihood × impact/i);
      expect(src, rel).not.toMatch(/Likelihood × impact/);
    }
    const risks = readFileSync(join(WEB, "app/risks/risks-client.tsx"), "utf8");
    expect(risks).toMatch(/How likely/);
    expect(risks).toMatch(/How bad/);
    const burndown = readFileSync(join(WEB, "app/risk-burndown/risk-burndown-client.tsx"), "utf8");
    expect(burndown).toMatch(/How likely/);
    expect(burndown).toMatch(/How bad/);
    expect(burndown).toMatch(/Failure log/);
  });

  it("paints generated L×I and PID labels in student words", () => {
    expect(formatLikelihoodImpact({ likelihood: 4, impact: 5 })).toBe("How likely 4 · How bad 5");
    expect(tuningControllerTypeLabel("pid")).toBe("Gains");
    expect(tuningControllerTypeLabel("pidf")).toBe("Gains + extra");
    expect(tuningControllerTypeLabel("feedforward")).toBe("Extra");
    expect(TUNING_CATEGORY_LABEL.pid).toBe("Gains");
    expect(TUNING_CATEGORY_LABEL.feedforward).toBe("Extra");
    expect(CURRENT_LIMIT_TUNING_CUE).not.toMatch(/PID/);
    expect(CURRENT_LIMIT_TUNING_CUE).toMatch(/gain and encoder values/);
  });
});
