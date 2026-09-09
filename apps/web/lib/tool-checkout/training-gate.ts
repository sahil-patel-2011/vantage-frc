/**
 * Training-matrix gate for tool checkout.
 *
 * The matrix owns "who is signed off on mill / lathe / safety". Checkout owns
 * "who has the key". If a skill in the matrix applies to the tool, checkout
 * refuses unless the borrower holds a current certification for one of those
 * skills. Expired certs do not count. No matching skill means the matrix does
 * not require a cert and checkout stays open.
 *
 * Status is derived with `certificationStatus` — the same helper Training uses —
 * so a cert that Training would paint expired is refused here too.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { matchPersonName } from "../presence/match-names";
import { certificationStatus, trainingCategoryLabel } from "../training";
import { computeTrainingView } from "../training/compute-training";
import type { TrainingCategory, TrainingCertification, TrainingSkill } from "../training/types";
import type { ToolCategory, ToolRequiredSkill } from "./types";

export type TrainingMatrixSlice = {
  skills: TrainingSkill[];
  certifications: TrainingCertification[];
  members: Array<{ userId: string; name: string }>;
};

export type ToolCheckoutGateInput = {
  toolName: string;
  toolCategory: ToolCategory;
  skills: Array<{ id: string; name: string; category: TrainingCategory }>;
  certifications: Array<Pick<TrainingCertification, "skillId" | "memberUserId" | "expiresAt">>;
  members: Array<{ userId: string; name: string }>;
  borrowerUserId?: string | null;
  borrowerName: string;
  now?: Date;
};

export type ToolCheckoutGateResult =
  | {
      allowed: true;
      memberUserId: string | null;
      memberName: string | null;
      requiredSkills: ToolRequiredSkill[];
    }
  | {
      allowed: false;
      reason: string;
      memberUserId: string | null;
      memberName: string | null;
      requiredSkills: ToolRequiredSkill[];
      missingSkills: ToolRequiredSkill[];
    };

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack === needle) return true;
  return ` ${haystack} `.includes(` ${needle} `);
}

/** True when the training skill is the cert the matrix requires for this tool. */
export function skillAppliesToTool(
  skill: { name: string; category: TrainingCategory },
  tool: { name: string; category: ToolCategory },
): boolean {
  const toolName = normalizePhrase(tool.name);
  const skillName = normalizePhrase(skill.name);
  if (!toolName || !skillName) return false;
  if (containsPhrase(toolName, skillName) || containsPhrase(skillName, toolName)) return true;

  if (skill.category !== "other") {
    const categoryWord = normalizePhrase(trainingCategoryLabel(skill.category));
    if (categoryWord && containsPhrase(toolName, categoryWord)) return true;
  }

  return skill.category === "safety" && tool.category === "safety";
}

export function skillsRequiredForTool(
  tool: { name: string; category: ToolCategory },
  skills: Array<{ id: string; name: string; category: TrainingCategory }>,
): ToolRequiredSkill[] {
  return skills
    .filter((skill) => skillAppliesToTool(skill, tool))
    .map((skill) => ({ id: skill.id, name: skill.name, category: skill.category }));
}

export function certIsCurrent(
  cert: Pick<TrainingCertification, "expiresAt">,
  now: Date = new Date(),
): boolean {
  const status = certificationStatus(cert.expiresAt, now);
  return status === "active" || status === "expiring_soon";
}

function resolveBorrower(
  input: Pick<ToolCheckoutGateInput, "borrowerUserId" | "borrowerName" | "members">,
): { userId: string; name: string } | null {
  const roster = input.members.filter((member) => member.userId && member.name.trim());
  if (input.borrowerUserId) {
    return roster.find((member) => member.userId === input.borrowerUserId) ?? null;
  }
  const name = input.borrowerName.trim();
  if (!name) return null;
  const match = matchPersonName(
    name,
    roster.map((member) => ({ userId: member.userId, name: member.name })),
  );
  if (match.resolution !== "auto" || !match.autoUserId) return null;
  return roster.find((member) => member.userId === match.autoUserId) ?? null;
}

/**
 * Pure decision: allow checkout, or refuse with the skills the borrower is missing.
 * The member needs a current cert for at least one skill the matrix applies to the tool.
 */
export function evaluateToolCheckoutGate(input: ToolCheckoutGateInput): ToolCheckoutGateResult {
  const requiredSkills = skillsRequiredForTool(
    { name: input.toolName, category: input.toolCategory },
    input.skills,
  );
  const borrower = resolveBorrower(input);
  const memberUserId = borrower?.userId ?? null;
  const memberName = borrower?.name ?? (input.borrowerName.trim() || null);

  if (requiredSkills.length === 0) {
    return { allowed: true, memberUserId, memberName, requiredSkills };
  }

  if (!borrower) {
    return {
      allowed: false,
      reason: `${input.toolName} requires a training certification. Name a roster member so we can check their cert.`,
      memberUserId: null,
      memberName,
      requiredSkills,
      missingSkills: requiredSkills,
    };
  }

  const now = input.now ?? new Date();
  const held = new Set(
    input.certifications
      .filter(
        (cert) =>
          cert.memberUserId === borrower.userId &&
          requiredSkills.some((skill) => skill.id === cert.skillId) &&
          certIsCurrent(cert, now),
      )
      .map((cert) => cert.skillId),
  );
  const missingSkills = requiredSkills.filter((skill) => !held.has(skill.id));

  if (held.size === 0) {
    const names = requiredSkills.map((skill) => skill.name).join(" or ");
    return {
      allowed: false,
      reason: `Checkout refused: ${borrower.name} is not certified for ${names}. Sign off the Training matrix first.`,
      memberUserId: borrower.userId,
      memberName: borrower.name,
      requiredSkills,
      missingSkills,
    };
  }

  return { allowed: true, memberUserId: borrower.userId, memberName: borrower.name, requiredSkills };
}

/**
 * Read the live training matrix for this org, or an empty slice when Training is
 * not set up / the tables are not there yet. An empty slice means no cert is required.
 */
export async function loadTrainingMatrixForCheckout(
  client: PoolClient,
  input: { userId: string; orgId: string; now?: Date },
): Promise<TrainingMatrixSlice> {
  // Deliberately NOT tolerant. An empty slice means "no certification required",
  // so swallowing a read failure here fails a safety gate open: `checkoutTool`
  // would hand over a tool whose training requirement could not be checked. A
  // Training feature that is genuinely absent still returns the empty slice via
  // `status !== "live"` below — that path is a real answer, a caught error is not.
  const view = await computeTrainingView(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
    now: input.now,
  });
  if (view.status !== "live") return { skills: [], certifications: [], members: [] };
  return {
    skills: view.skills,
    certifications: view.certifications,
    members: view.members.map((member) => ({ userId: member.userId, name: member.name })),
  };
}

export function assertToolCheckoutAllowed(input: ToolCheckoutGateInput): {
  memberUserId: string | null;
  memberName: string;
} {
  const decision = evaluateToolCheckoutGate(input);
  if (!decision.allowed) throw new Error(decision.reason);
  return {
    memberUserId: decision.memberUserId,
    memberName: decision.memberName ?? input.borrowerName.trim(),
  };
}
