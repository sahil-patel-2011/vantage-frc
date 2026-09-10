import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  MENTOR_HOURS_CATEGORIES,
  MENTOR_HOURS_ROLES,
  computeMentorHoursView,
  currentSeasonYear,
  deleteEntry,
  logEntry,
  type MentorHoursView,
} from "../../../lib/mentor-hours/compute-mentor-hours";
import { positiveDurationMinutes } from "../../../lib/mentor-hours/ledger";
import type { MentorHoursCategory, MentorHoursRole } from "../../../lib/mentor-hours/types";

export type { MentorHoursView };

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
      computeMentorHoursView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Mentor Hours. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MentorHoursView,
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
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "log-entry": {
          const mentorName = trimmedOrNull(body.mentorName, 200);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!mentorName) throw new Error("mentorName is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          const role = oneOf<MentorHoursRole>(MENTOR_HOURS_ROLES, body.role) ?? "mentor";
          const category = oneOf<MentorHoursCategory>(MENTOR_HOURS_CATEGORIES, body.category) ?? "build";
          const durationMinutes = positiveDurationMinutes(body.durationMinutes);
          if (durationMinutes == null) throw new Error("durationMinutes must be a positive number of minutes.");
          await logEntry(client, {
            orgId,
            userId,
            mentorName,
            role,
            category,
            occurredOn,
            durationMinutes,
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteEntry(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMentorHoursView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mentor Hours request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
