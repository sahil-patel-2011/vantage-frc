import type { PoolClient } from "@neondatabase/serverless";
import { addSkill, certifyMember, computeTrainingView } from "../training/compute-training";
import { buildSkillTreeModel, signOffBlocker } from "./progress";
import { SKILL_TREES, trainingSkillForNode } from "./trees";

/** Most members a single group sign-off may cover. */
export const MAX_GROUP_SIGN_OFF = 60;

/**
 * Create the team's tree skills that don't exist yet (one training skill per tree skill). Run
 * by an owner or admin; safe to run again — only missing skills are added.
 */
export async function setupSkillTrees(client: PoolClient, input: { orgId: string; userId: string }): Promise<number> {
  const view = await computeTrainingView(client, { userId: input.userId, requestedOrg: input.orgId });
  if (view.status !== "live") return 0;
  const model = buildSkillTreeModel({ skills: view.skills, certifications: [], memberIds: [] });
  for (const node of model.missing) {
    const tree = SKILL_TREES.find((entry) => entry.key === node.tree)!;
    const row = trainingSkillForNode(node, tree);
    await addSkill(client, { orgId: input.orgId, userId: input.userId, ...row });
  }
  return model.missing.length;
}

/**
 * Sign off one tree skill for several members at once (a whole training session). Each member
 * is checked against the unlock order on the server; anyone not ready yet, or already signed
 * off, is skipped and named in the result.
 */
export async function signOffGroup(
  client: PoolClient,
  input: { orgId: string; userId: string; skillKey: string; memberUserIds: string[]; certifiedAt: string; notes: string | null },
): Promise<{ signed: number; skipped: Array<{ memberUserId: string; reason: string }> }> {
  const view = await computeTrainingView(client, { userId: input.userId, requestedOrg: input.orgId });
  if (view.status !== "live") throw new Error("Choose your team first.");
  const members = new Set(view.members.map((member) => member.userId));
  const ids = [...new Set(input.memberUserIds)].filter((id) => members.has(id)).slice(0, MAX_GROUP_SIGN_OFF);
  const model = buildSkillTreeModel({ skills: view.skills, certifications: view.certifications, memberIds: ids });
  const skillId = model.skillIdByKey.get(input.skillKey);
  if (!skillId) throw new Error("Set up the skill trees before signing off.");
  let signed = 0;
  const skipped: Array<{ memberUserId: string; reason: string }> = [];
  for (const memberUserId of ids) {
    const blocker = signOffBlocker(model, memberUserId, input.skillKey);
    if (blocker) {
      skipped.push({ memberUserId, reason: blocker });
      continue;
    }
    await certifyMember(client, {
      orgId: input.orgId,
      userId: input.userId,
      skillId,
      memberUserId,
      certifiedAt: input.certifiedAt,
      expiresAt: null,
      notes: input.notes,
    });
    signed += 1;
  }
  return { signed, skipped };
}
