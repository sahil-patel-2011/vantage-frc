import { describe, expect, it } from "vitest";
import {
  CODE_COACH_SAMPLE,
  codeCoachNextActions,
  codeCoachRelatedLinks,
  groundedCodeCoachProposal,
  isCodeCoachSampleContent,
} from "./code-related";

describe("codeCoachRelatedLinks", () => {
  it("returns empty without org", () => {
    expect(codeCoachRelatedLinks()).toEqual([]);
  });

  it("includes CAD, GitHub, and AI chat for a workspace", () => {
    const links = codeCoachRelatedLinks("org-1");
    expect(links.map((l) => l.id)).toEqual(
      expect.arrayContaining(["cad", "github", "chat", "pair", "usage", "budgets"]),
    );
    expect(links.find((l) => l.id === "cad")?.href).toContain("/build");
    expect(links.find((l) => l.id === "cad")?.href).toContain("tab=cad");
    expect(links.find((l) => l.id === "github")?.href).toBe("/team/admin?orgId=org-1#github-connection");
    expect(links.find((l) => l.id === "chat")?.href).toContain("/ai");
  });
});

describe("codeCoachNextActions", () => {
  it("asks for workspace when org is missing", () => {
    const actions = codeCoachNextActions({});
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("prioritizes paste / review before CAD and chat cross-links", () => {
    const empty = codeCoachNextActions({ orgId: "org-1", hasSource: false });
    expect(empty[0]?.id).toBe("paste");
    expect(empty.some((a) => a.id === "cad")).toBe(true);
    expect(empty.some((a) => a.id === "chat")).toBe(true);

    const ready = codeCoachNextActions({ orgId: "org-1", hasSource: true, hasReview: false });
    expect(ready[0]?.id).toBe("review");
  });
});

describe("groundedCodeCoachProposal", () => {
  it("allows the teaching-sample diff only for sample content", () => {
    const sample = groundedCodeCoachProposal({
      path: "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
      content: CODE_COACH_SAMPLE,
    });
    expect(sample?.unifiedDiff).toContain("Timer.delay");
    expect(sample?.unifiedDiff).toContain("MathUtil.clamp");
    expect(isCodeCoachSampleContent(CODE_COACH_SAMPLE)).toBe(true);
  });

  it("refuses to invent a diff for arbitrary source", () => {
    expect(
      groundedCodeCoachProposal({
        path: "Robot.java",
        content: "class Robot { void periodic() { driveMotor.set(0.5); } }",
      }),
    ).toBeNull();
  });

  it("accepts a caller-supplied unified diff", () => {
    const diff = "--- a/Robot.java\n+++ b/Robot.java\n@@ -1 +1 @@\n-old\n+new";
    expect(groundedCodeCoachProposal({ path: "Robot.java", content: "old", unifiedDiff: diff })).toEqual({
      summary: "Proposed safe change",
      unifiedDiff: diff,
    });
  });
});
