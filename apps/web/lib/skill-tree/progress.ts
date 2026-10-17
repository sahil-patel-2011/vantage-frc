import type { TrainingCertification, TrainingSkill } from "../training/types";
import { allSkillNodes, SKILL_TREES, skillKeyFromDescription, type SkillNode, type SkillTreeDef } from "./trees";

/** Most members a single group sign-off may cover (the dialog caps picks at this too). */
export const MAX_GROUP_SIGN_OFF = 60;

/** One skill for one member. Expired counts as not done (Safety is redone each year). */
export type SkillState = "locked" | "available" | "complete" | "expired";
/** One tree for one member. */
export type TreeState = "locked" | "available" | "in_progress" | "complete";

export type MemberTreeProgress = { tree: string; done: number; total: number; state: TreeState };

export type SkillTreeModel = {
  nodes: SkillNode[];
  /** Tree skill key → the team's training_skills id (absent until set up). */
  skillIdByKey: Map<string, string>;
  /** Skills not yet created for this team; non-empty means "Set up skill trees" is due. */
  missing: SkillNode[];
  /** Member → skill key → state. */
  states: Map<string, Map<string, SkillState>>;
  /** Member → per-tree progress, in tree order. */
  memberTrees: Map<string, MemberTreeProgress[]>;
  /** Per tree: the team's average share done (0–100) and how many members finished it. */
  teamTrees: Array<{ tree: SkillTreeDef; averagePct: number; finished: number; members: number; skills: number }>;
};

export function buildSkillTreeModel(input: {
  skills: TrainingSkill[];
  certifications: TrainingCertification[];
  memberIds: string[];
  trees?: readonly SkillTreeDef[];
}): SkillTreeModel {
  const trees = input.trees ?? SKILL_TREES;
  const nodes = allSkillNodes(trees);
  const skillIdByKey = new Map<string, string>();
  for (const skill of input.skills) {
    const key = skillKeyFromDescription(skill.description);
    if (key && !skillIdByKey.has(key)) skillIdByKey.set(key, skill.id);
  }
  const keyBySkillId = new Map([...skillIdByKey].map(([key, id]) => [id, key]));
  const missing = nodes.filter((node) => !skillIdByKey.has(node.key));

  // Member → key → best certification status (active beats expiring beats expired).
  const rank = { active: 3, expiring_soon: 2, expired: 1 } as const;
  const certified = new Map<string, Map<string, keyof typeof rank>>();
  for (const cert of input.certifications) {
    const key = keyBySkillId.get(cert.skillId);
    if (!key) continue;
    const forMember = certified.get(cert.memberUserId) ?? new Map<string, keyof typeof rank>();
    const prior = forMember.get(key);
    if (!prior || rank[cert.status] > rank[prior]) forMember.set(key, cert.status);
    certified.set(cert.memberUserId, forMember);
  }

  const states = new Map<string, Map<string, SkillState>>();
  const memberTrees = new Map<string, MemberTreeProgress[]>();
  for (const memberId of input.memberIds) {
    const status = certified.get(memberId) ?? new Map();
    const done = (key: string) => {
      const value = status.get(key);
      return value === "active" || value === "expiring_soon";
    };
    const nodeStates = new Map<string, SkillState>();
    for (const node of nodes) {
      const value = status.get(node.key);
      nodeStates.set(
        node.key,
        value === "active" || value === "expiring_soon"
          ? "complete"
          : node.prerequisites.every(done)
            ? value === "expired"
              ? "expired"
              : "available"
            : "locked",
      );
    }
    states.set(memberId, nodeStates);
    memberTrees.set(
      memberId,
      trees.map((tree) => {
        const treeNodes = nodes.filter((node) => node.tree === tree.key);
        const finished = treeNodes.filter((node) => nodeStates.get(node.key) === "complete").length;
        const anyOpen = treeNodes.some((node) => nodeStates.get(node.key) !== "locked");
        const state: TreeState =
          finished === treeNodes.length ? "complete" : finished > 0 ? "in_progress" : anyOpen ? "available" : "locked";
        return { tree: tree.key, done: finished, total: treeNodes.length, state };
      }),
    );
  }

  const teamTrees = trees.map((tree, index) => {
    const rows = input.memberIds.map((id) => memberTrees.get(id)![index]!);
    const skills = rows[0]?.total ?? nodes.filter((node) => node.tree === tree.key).length;
    const averagePct = rows.length ? Math.round((rows.reduce((sum, row) => sum + row.done / Math.max(1, row.total), 0) / rows.length) * 100) : 0;
    return { tree, averagePct, finished: rows.filter((row) => row.state === "complete").length, members: rows.length, skills };
  });

  return { nodes, skillIdByKey, missing, states, memberTrees, teamTrees };
}

/** Why a member can't be signed off on a skill yet, or null when they can. */
export function signOffBlocker(model: SkillTreeModel, memberId: string, key: string): string | null {
  const node = model.nodes.find((entry) => entry.key === key);
  if (!node) return "That skill isn't in the skill trees.";
  const state = model.states.get(memberId)?.get(key);
  if (state === "complete") return "Already signed off.";
  if (state === "locked") {
    const waiting = node.prerequisites
      .filter((prereq) => model.states.get(memberId)?.get(prereq) !== "complete")
      .map((prereq) => model.nodes.find((entry) => entry.key === prereq)?.title ?? prereq);
    return `Needs ${waiting.slice(0, 2).join(" and ")}${waiting.length > 2 ? ` and ${waiting.length - 2} more` : ""} first.`;
  }
  return null;
}
