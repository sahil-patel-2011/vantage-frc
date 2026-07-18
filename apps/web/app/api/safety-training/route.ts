import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SAFETY_CATEGORIES } from "../../../lib/safety-training";
import {
  computeSafetyTrainingView,
  createModule,
  deleteCompletion,
  deleteModule,
  recordCompletion,
  type SafetyTrainingView,
} from "../../../lib/safety-training/compute-safety-training";
import type { SafetyCategory } from "../../../lib/safety-training/types";

export type { SafetyTrainingView };

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
      computeSafetyTrainingView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Safety Training. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies SafetyTrainingView,
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
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-module": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const category = oneOf<SafetyCategory>(SAFETY_CATEGORIES, body.category) ?? "shop_general";
          await createModule(client, {
            orgId,
            userId,
            title,
            category,
            description: trimmedOrNull(body.description, 2000),
            isRequired: body.isRequired !== false,
            validityMonths: positiveIntOrNull(body.validityMonths),
          });
          break;
        }
        case "delete-module": {
          const moduleId = trimmedOrNull(body.moduleId, 64);
          if (!moduleId) throw new Error("moduleId is required");
          await deleteModule(client, { orgId, moduleId });
          break;
        }
        case "record-completion": {
          const moduleId = trimmedOrNull(body.moduleId, 64);
          const memberId = trimmedOrNull(body.memberId, 64);
          const completedOn = isoDateOrNull(body.completedOn);
          if (!moduleId) throw new Error("moduleId is required");
          if (!memberId) throw new Error("memberId is required");
          if (!completedOn) throw new Error("completedOn (YYYY-MM-DD) is required");
          await recordCompletion(client, {
            orgId,
            userId,
            moduleId,
            memberId,
            completedOn,
            certificateUrl: trimmedOrNull(body.certificateUrl, 500),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-completion": {
          const completionId = trimmedOrNull(body.completionId, 64);
          if (!completionId) throw new Error("completionId is required");
          await deleteCompletion(client, { orgId, completionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSafetyTrainingView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Safety Training request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
