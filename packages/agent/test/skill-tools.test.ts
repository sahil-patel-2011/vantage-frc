import { describe, expect, it } from "vitest";
import {
  annotateToolOutput,
  isSkillToolOutput,
  planTurnTools,
  skillIdFromToolName,
  skillToolName,
  toolUsesOrgData,
  type SkillToolOutput,
} from "../src";

const sponsor = { name: "skill.sponsorships", input: { request: "Who should we ask next?" } };
const scouting = { name: "scouting.team", input: { teamKey: "frc254" } };

describe("Ask AI skills in a chat turn", () => {
  it("runs a pinned skill before the model even when the model calls its own tools", () => {
    const turn = planTurnTools({
      forced: [sponsor],
      fallback: [scouting],
      nativeCandidates: ["skill.sponsorships", "skill.grant-reports"],
      explicit: false,
      supportsNativeTools: true,
    });
    expect(turn.native).toBe(true);
    expect(turn.upFront).toEqual([sponsor]);
    // The pinned skill is not offered twice; the planner's tools and other skills are the choice.
    expect(turn.candidateNames).toEqual(["scouting.team", "skill.grant-reports"]);
    expect(turn.planned).toEqual([sponsor, scouting]);
  });

  it("lets a tool-calling model pick a skill the keywords missed", () => {
    const turn = planTurnTools({
      forced: [],
      fallback: [],
      nativeCandidates: ["skill.sponsorships"],
      explicit: false,
      supportsNativeTools: true,
    });
    expect(turn.native).toBe(true);
    expect(turn.upFront).toEqual([]);
    expect(turn.candidateNames).toEqual(["skill.sponsorships"]);
  });

  it("without native tools only the keyword choice and the planner run; other skills never do", () => {
    const turn = planTurnTools({
      forced: [sponsor],
      fallback: [scouting],
      nativeCandidates: ["skill.grant-reports"],
      explicit: false,
      supportsNativeTools: false,
    });
    expect(turn.native).toBe(false);
    expect(turn.upFront).toEqual([sponsor, scouting]);
    expect(turn.candidateNames).toEqual([]);
  });

  it("keeps explicit tool calls exactly as the caller named them", () => {
    const turn = planTurnTools({
      forced: [sponsor],
      fallback: [scouting],
      nativeCandidates: ["skill.grant-reports"],
      explicit: true,
      supportsNativeTools: true,
    });
    expect(turn).toEqual({ native: false, upFront: [scouting], candidateNames: [], planned: [scouting] });
  });

  it("reads a skill's own summary and status instead of guessing from the shape", () => {
    const output: SkillToolOutput = {
      kind: "vantage_skill",
      skill: "sponsorships",
      status: "empty",
      classification: "hard_metric",
      summary: "No sponsor records yet. Add one under Business › Sponsors.",
      highlights: [],
      data: { sponsors: [] },
      next: { label: "Add a sponsor", href: "/business?tab=sponsors" },
    };
    expect(isSkillToolOutput(output)).toBe(true);
    const annotated = annotateToolOutput("skill.sponsorships", output, sponsor.input);
    expect(annotated.status).toBe("empty");
    expect(annotated.summary).toBe(output.summary);
    expect(annotated.classification).toBe("hard_metric");
    expect(isSkillToolOutput({ kind: "vantage_skill", skill: "x", status: "maybe", summary: "" })).toBe(false);
  });

  it("names skill tools one way and counts them as team data for billing", () => {
    expect(skillToolName("sponsorships")).toBe("skill.sponsorships");
    expect(skillIdFromToolName("skill.sponsorships")).toBe("sponsorships");
    expect(skillIdFromToolName("scouting.team")).toBeNull();
    expect(skillIdFromToolName("skill.")).toBeNull();
    expect(toolUsesOrgData("skill.sponsorships")).toBe(true);
    expect(toolUsesOrgData("web.search")).toBe(false);
  });
});
