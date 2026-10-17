import type { PoolClient } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingSkill } from "../training/types";
import { allSkillNodes, SKILL_TREES, trainingSkillForNode } from "./trees";

const training = vi.hoisted(() => ({ computeTrainingView: vi.fn(), certifyMember: vi.fn(), addSkill: vi.fn() }));
vi.mock("../training/compute-training", () => training);

import { MAX_GROUP_SIGN_OFF, signOffGroup } from "./actions";

const skills: TrainingSkill[] = allSkillNodes().map((node, index) => {
  const tree = SKILL_TREES.find((entry) => entry.key === node.tree)!;
  const row = trainingSkillForNode(node, tree);
  return { id: `s${index}`, name: row.name, category: row.category, description: row.description, validityMonths: row.validityMonths, createdAt: "" };
});
const client = {} as PoolClient;

describe("signOffGroup", () => {
  beforeEach(() => {
    training.certifyMember.mockReset().mockResolvedValue(undefined);
  });

  it("names everyone past the batch cap in skipped instead of dropping them silently", async () => {
    const members = Array.from({ length: MAX_GROUP_SIGN_OFF + 5 }, (_, index) => ({ userId: `m${index}` }));
    training.computeTrainingView.mockResolvedValue({ status: "live", members, skills, certifications: [] });
    const result = await signOffGroup(client, {
      orgId: "org",
      userId: "mentor",
      skillKey: "safety.ppe",
      memberUserIds: members.map((member) => member.userId),
      certifiedAt: "2026-10-16",
      notes: null,
    });
    expect(result.signed).toBe(MAX_GROUP_SIGN_OFF);
    expect(training.certifyMember).toHaveBeenCalledTimes(MAX_GROUP_SIGN_OFF);
    expect(result.skipped.map((row) => row.memberUserId)).toEqual(["m60", "m61", "m62", "m63", "m64"]);
    expect(result.skipped[0]!.reason).toMatch(/second batch/);
  });
});
