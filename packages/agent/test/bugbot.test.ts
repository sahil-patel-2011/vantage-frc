import { describe, expect, it } from "vitest";
import {
  BUGBOT_ULTRA_PRICES_USD,
  bugbotUltraChargeUsd,
  formatBugbotScanBundle,
  groundBugbotFindings,
  groundBugbotFix,
  mergeBugbotReview,
  pickBugbotScanEntries,
} from "../src/bugbot";

const SOURCE = `public void periodic() {
  Timer.delay(0.02);
  new TalonFX(4);
}
`;

describe("AI Bugbot grounding", () => {
  it("drops model findings whose evidence is not in the source", () => {
    const grounded = groundBugbotFindings({
      path: "Drive.java",
      content: SOURCE,
      modelText: JSON.stringify({
        findings: [
          { severity: "high", finding: "Blocking loop starves scheduler", evidence: "Timer.delay(0.02)" },
          { severity: "high", finding: "Invented brownout", evidence: "setVoltage(99)" },
        ],
      }),
    });
    expect(grounded.findings).toHaveLength(1);
    expect(grounded.findings[0]?.location).toBe("Drive.java:2");
    expect(grounded.droppedUngrounded).toBe(1);
  });

  it("merges local pattern hits with grounded model findings", () => {
    const review = mergeBugbotReview({
      path: "Drive.java",
      content: SOURCE,
      modelText: '{"findings":[{"severity":"medium","finding":"Hard-coded CAN id","evidence":"new TalonFX(4)"}]}',
    });
    expect(review.localRiskCount).toBeGreaterThan(0);
    expect(review.modelFindingCount).toBe(1);
    expect(review.findings.some((item) => item.source === "local_rule")).toBe(true);
    expect(review.findings.some((item) => item.source === "model" && item.evidence.includes("TalonFX"))).toBe(true);
    expect(review.riskLevel).toBe("high");
  });

  it("stays empty of model findings when the planner returns prose", () => {
    const review = mergeBugbotReview({
      path: "Robot.java",
      content: "class Robot {}",
      modelText: "Looks fine to me.",
    });
    expect(review.modelFindingCount).toBe(0);
    expect(review.findings.every((item) => item.source === "local_rule")).toBe(true);
  });
});

describe("Bugbot Ultra scan pick + fix grounding", () => {
  it("publishes flat scan/fix/recheck prices", () => {
    expect(BUGBOT_ULTRA_PRICES_USD).toEqual({ scan: 1, fix: 2, recheck: 1 });
    expect(bugbotUltraChargeUsd("fix")).toBe(2);
  });

  it("picks robot-code blobs and skips generated trees", () => {
    const picked = pickBugbotScanEntries([
      { path: "node_modules/wpilib/Robot.java", type: "blob", size: 100 },
      { path: "README.md", type: "blob", size: 100 },
      { path: "src/main/java/frc/robot/Robot.java", type: "blob", size: 400 },
      { path: "src/main/java/frc/robot/subsystems/Drive.java", type: "blob", size: 800 },
      { path: "build/generated/Foo.java", type: "blob", size: 50 },
      { path: "vendordeps/Phoenix6.json", type: "blob", size: 200 },
    ]);
    expect(picked[0]).toBe("src/main/java/frc/robot/Robot.java");
    expect(picked).toContain("src/main/java/frc/robot/subsystems/Drive.java");
    expect(picked).toContain("vendordeps/Phoenix6.json");
    expect(picked.some((path) => path.includes("node_modules") || path.includes("build/"))).toBe(false);
  });

  it("formats a scan bundle from loaded files only", () => {
    const bundle = formatBugbotScanBundle([
      { path: "Drive.java", content: "new TalonFX(4);" },
      { path: "empty.txt", content: "   " },
    ]);
    expect(bundle.filesScanned).toBe(1);
    expect(bundle.content).toContain("===== FILE: Drive.java =====");
    expect(bundle.content).toContain("new TalonFX(4);");
  });

  it("keeps a unified diff only when removed lines exist in the source", () => {
    const kept = groundBugbotFix({
      path: "Drive.java",
      content: SOURCE,
      modelText: [
        "```diff",
        "--- a/Drive.java",
        "+++ b/Drive.java",
        "@@ -1,3 +1,2 @@",
        " public void periodic() {",
        "-  Timer.delay(0.02);",
        "   new TalonFX(4);",
        " }",
        "```",
      ].join("\n"),
    });
    expect(kept.unifiedDiff).toContain("-  Timer.delay(0.02);");
    expect(kept.dropped).toBe(false);

    const dropped = groundBugbotFix({
      path: "Drive.java",
      content: SOURCE,
      modelText: "--- a/Drive.java\n+++ b/Drive.java\n@@ -1 +1 @@\n-setVoltage(99)\n+ok\n",
    });
    expect(dropped.unifiedDiff).toBeNull();
    expect(dropped.dropped).toBe(true);
  });
});
