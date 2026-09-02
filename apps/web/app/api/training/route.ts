import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  TRAINING_CATEGORIES,
  addSkill,
  certifyMember,
  computeTrainingView,
  deleteSkill,
  revokeCertification,
  type TrainingView,
} from "../../../lib/training/compute-training";
import type { TrainingCategory } from "../../../lib/training/types";

export type { TrainingView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTrainingView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Training Matrix. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies TrainingView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");
      // Skills and sign-offs are mentor-tier records: owner/admin only. Every
      // member still reads the matrix (GET is unchanged).
      const role = member.rows[0]!.role;
      if (role !== "owner" && role !== "admin") throw new Error("mentor_required");

      switch (action) {
        case "add-skill": {
          const name = trimmedOrNull(body.name, 120);
          if (!name) throw new Error("name is required");
          const category = oneOf<TrainingCategory>(TRAINING_CATEGORIES, body.category) ?? "other";
          await addSkill(client, {
            orgId,
            userId,
            name,
            category,
            description: trimmedOrNull(body.description, 2000),
            validityMonths: positiveIntOrNull(body.validityMonths),
          });
          break;
        }
        case "delete-skill": {
          const skillId = trimmedOrNull(body.skillId, 64);
          if (!skillId) throw new Error("skillId is required");
          await deleteSkill(client, { orgId, skillId });
          break;
        }
        case "certify": {
          const skillId = trimmedOrNull(body.skillId, 64);
          const memberUserId = trimmedOrNull(body.memberUserId, 64);
          const certifiedAt = isoDateOrNull(body.certifiedAt);
          if (!skillId) throw new Error("skillId is required");
          if (!memberUserId) throw new Error("memberUserId is required");
          if (!certifiedAt) throw new Error("certifiedAt (YYYY-MM-DD) is required");
          await certifyMember(client, {
            orgId,
            userId,
            skillId,
            memberUserId,
            certifiedAt,
            expiresAt: isoDateOrNull(body.expiresAt),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "revoke-certification": {
          const certificationId = trimmedOrNull(body.certificationId, 64);
          if (!certificationId) throw new Error("certificationId is required");
          await revokeCertification(client, { orgId, certificationId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeTrainingView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Training Matrix request failed";
    if (message === "mentor_required") {
      return Response.json(
        { error: "Only an owner or admin can add skills or sign off certifications. Ask a mentor to record this." },
        { status: 403 },
      );
    }
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
