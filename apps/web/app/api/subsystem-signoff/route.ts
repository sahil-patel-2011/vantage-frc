import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SIGNOFF_DECISIONS, SIGNOFF_GATES, SUBSYSTEM_CATEGORIES, SUBSYSTEM_STATUSES } from "../../../lib/subsystem-signoff";
import {
  addSubsystem,
  computeSubsystemSignoffView,
  currentSeasonYear,
  deleteSignoff,
  deleteSubsystem,
  recordSignoff,
  updateSubsystemStatus,
  type SubsystemSignoffView,
} from "../../../lib/subsystem-signoff/compute-subsystem-signoff";
import type {
  SignoffDecision,
  SignoffGate,
  SubsystemCategory,
  SubsystemStatus,
} from "../../../lib/subsystem-signoff/types";

export type { SubsystemSignoffView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSubsystemSignoffView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load subsystem sign-offs. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SubsystemSignoffView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-subsystem": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const category = oneOf<SubsystemCategory>(SUBSYSTEM_CATEGORIES, body.category) ?? "other";
          await addSubsystem(client, {
            orgId,
            userId,
            name,
            category,
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const subsystemId = trimmedOrNull(body.subsystemId, 64);
          const status = oneOf<SubsystemStatus>(SUBSYSTEM_STATUSES, body.status);
          if (!subsystemId) throw new Error("subsystemId is required");
          if (!status) throw new Error("valid status is required");
          await updateSubsystemStatus(client, { orgId, subsystemId, status });
          break;
        }
        case "delete-subsystem": {
          const subsystemId = trimmedOrNull(body.subsystemId, 64);
          if (!subsystemId) throw new Error("subsystemId is required");
          await deleteSubsystem(client, { orgId, subsystemId });
          break;
        }
        case "record-signoff": {
          const subsystemId = trimmedOrNull(body.subsystemId, 64);
          const gate = oneOf<SignoffGate>(SIGNOFF_GATES, body.gate);
          const signedOn = isoDateOrNull(body.signedOn);
          if (!subsystemId) throw new Error("subsystemId is required");
          if (!gate) throw new Error("valid gate is required");
          if (!signedOn) throw new Error("signedOn (YYYY-MM-DD) is required");
          const decision = oneOf<SignoffDecision>(SIGNOFF_DECISIONS, body.decision) ?? "approved";
          await recordSignoff(client, {
            orgId,
            userId,
            subsystemId,
            gate,
            decision,
            signedOn,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-signoff": {
          const recordId = trimmedOrNull(body.recordId, 64);
          if (!recordId) throw new Error("recordId is required");
          await deleteSignoff(client, { orgId, recordId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSubsystemSignoffView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subsystem sign-off request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
