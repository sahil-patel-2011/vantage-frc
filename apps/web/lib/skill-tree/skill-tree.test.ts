import { describe, expect, it } from "vitest";
import type { TrainingCertification, TrainingSkill } from "../training/types";
import { buildSkillTreeModel, signOffBlocker } from "./progress";
import { allSkillNodes, SKILL_TREES, skillKeyFromDescription, trainingSkillForNode } from "./trees";

const nodes = allSkillNodes();
const skills: TrainingSkill[] = nodes.map((node, index) => {
  const tree = SKILL_TREES.find((entry) => entry.key === node.tree)!;
  const row = trainingSkillForNode(node, tree);
  return { id: `s${index}`, name: row.name, category: row.category, description: row.description, validityMonths: row.validityMonths, createdAt: "" };
});
const idOf = (key: string) => skills[nodes.findIndex((node) => node.key === key)]!.id;
const cert = (member: string, key: string, status: TrainingCertification["status"] = "active"): TrainingCertification => ({
  id: `${member}:${key}`,
  skillId: idOf(key),
  skillName: "",
  skillCategory: "other",
  memberUserId: member,
  memberName: member,
  memberEmail: "",
  certifiedByUserId: "mentor",
  certifiedByName: "Mentor",
  certifiedAt: "2026-09-01",
  expiresAt: null,
  notes: null,
  status,
});
const safetyKeys = nodes.filter((node) => node.tree === "safety").map((node) => node.key);

describe("skill trees", () => {
  it("defines nine trees, each skill with a stable key the team's training skill carries", () => {
    expect(SKILL_TREES.map((tree) => tree.key)).toEqual(["safety", "manufacturing", "design", "electrical", "programming", "drive", "scouting", "pit", "leadership"]);
    expect(new Set(nodes.map((node) => node.key)).size).toBe(nodes.length);
    expect(skillKeyFromDescription(skills[0]!.description)).toBe(nodes[0]!.key);
  });

  it("gates every other tree on all of Safety, and each skill on the one before it", () => {
    const firstManufacturing = nodes.find((node) => node.key === "manufacturing.calipers")!;
    expect(firstManufacturing.prerequisites.sort()).toEqual([...safetyKeys].sort());
    expect(nodes.find((node) => node.key === "safety.hand-tools")!.prerequisites).toEqual(["safety.ppe"]);
    expect(nodes.find((node) => node.key === "manufacturing.drill-press")!.prerequisites).toEqual(["manufacturing.calipers"]);
  });
});

describe("buildSkillTreeModel", () => {
  it("asks for setup until every tree skill exists for the team", () => {
    expect(buildSkillTreeModel({ skills: [], certifications: [], memberIds: ["a"] }).missing).toHaveLength(nodes.length);
    expect(buildSkillTreeModel({ skills, certifications: [], memberIds: ["a"] }).missing).toHaveLength(0);
  });

  it("opens a member's next skills as they're signed off, and other trees only after Safety", () => {
    const fresh = buildSkillTreeModel({ skills, certifications: [], memberIds: ["a"] });
    expect(fresh.states.get("a")!.get("safety.ppe")).toBe("available");
    expect(fresh.states.get("a")!.get("safety.hand-tools")).toBe("locked");
    expect(fresh.states.get("a")!.get("manufacturing.calipers")).toBe("locked");

    const safe = buildSkillTreeModel({ skills, certifications: safetyKeys.map((key) => cert("a", key)), memberIds: ["a", "b"] });
    expect(safe.states.get("a")!.get("manufacturing.calipers")).toBe("available");
    expect(safe.memberTrees.get("a")![0]).toEqual({ tree: "safety", done: 9, total: 9, state: "complete" });
    expect(safe.memberTrees.get("b")![1]!.state).toBe("locked");
    expect(safe.teamTrees[0]).toMatchObject({ averagePct: 50, finished: 1, members: 2, skills: 9 });
  });

  it("treats an expired sign-off as not done, so Safety must be redone", () => {
    const certs = safetyKeys.map((key, index) => cert("a", key, index === 0 ? "expired" : "active"));
    const model = buildSkillTreeModel({ skills, certifications: certs, memberIds: ["a"] });
    expect(model.states.get("a")!.get("safety.ppe")).toBe("expired");
    expect(model.states.get("a")!.get("manufacturing.calipers")).toBe("locked");
  });

  it("explains why a sign-off isn't possible yet", () => {
    const model = buildSkillTreeModel({ skills, certifications: [cert("a", "safety.ppe")], memberIds: ["a"] });
    expect(signOffBlocker(model, "a", "safety.hand-tools")).toBeNull();
    expect(signOffBlocker(model, "a", "safety.ppe")).toBe("Already signed off.");
    expect(signOffBlocker(model, "a", "safety.emergency")).toBe("Needs Hand tools first.");
  });
});
