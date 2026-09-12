import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  SCRIM_DATA_SHARE_SCOPES,
  SCRIM_STATUSES,
  computeCrossTeamScrimView,
  createScrimInvite,
  currentSeasonYear,
  deleteScrimInvite,
  updateScrimDataShareAgreement,
  updateScrimStatus,
  type CrossTeamScrimView,
} from "../../../lib/cross-team-scrim/compute-cross-team-scrim";
import type { ScrimDataShareScope, ScrimStatus } from "../../../lib/cross-team-scrim/types";

export type { CrossTeamScrimView };

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
      computeCrossTeamScrimView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load scrim scheduling. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies CrossTeamScrimView,
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
        case "create-invite": {
          const partnerTeamNumber = positiveIntOrNull(body.partnerTeamNumber);
          if (!partnerTeamNumber) throw new Error("partnerTeamNumber is required");
          const dataShareScope =
            oneOf<ScrimDataShareScope>(SCRIM_DATA_SHARE_SCOPES, body.dataShareScope) ?? "none";
          await createScrimInvite(client, {
            orgId,
            userId,
            partnerTeamNumber,
            partnerTeamName: trimmedOrNull(body.partnerTeamName, 200),
            contactName: trimmedOrNull(body.contactName, 200),
            contactEmail: trimmedOrNull(body.contactEmail, 320),
            proposedDate: isoDateOrNull(body.proposedDate),
            location: trimmedOrNull(body.location, 200),
            dataShareScope,
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const inviteId = trimmedOrNull(body.inviteId, 64);
          const status = oneOf<ScrimStatus>(SCRIM_STATUSES, body.status);
          if (!inviteId) throw new Error("inviteId is required");
          if (!status) throw new Error("valid status is required");
          await updateScrimStatus(client, { orgId, inviteId, status });
          break;
        }
        case "update-data-share": {
          const inviteId = trimmedOrNull(body.inviteId, 64);
          const dataShareScope = oneOf<ScrimDataShareScope>(SCRIM_DATA_SHARE_SCOPES, body.dataShareScope);
          if (!inviteId) throw new Error("inviteId is required");
          if (!dataShareScope) throw new Error("valid dataShareScope is required");
          await updateScrimDataShareAgreement(client, {
            orgId,
            inviteId,
            dataShareScope,
            dataShareAgreed: Boolean(body.dataShareAgreed),
          });
          break;
        }
        case "delete-invite": {
          const inviteId = trimmedOrNull(body.inviteId, 64);
          if (!inviteId) throw new Error("inviteId is required");
          await deleteScrimInvite(client, { orgId, inviteId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCrossTeamScrimView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cross-team scrim request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
