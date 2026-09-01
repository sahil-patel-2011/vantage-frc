import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeOutreachCalendarView,
  createOutreachEvent,
  currentSeasonYear,
  deleteOutreachEvent,
  updateOutreachEventStatus,
  type OutreachCalendarView,
} from "../../../lib/outreach-calendar/compute-outreach-calendar";
import {
  CompleteOutreachError,
  completeOutreachEventToImpact,
  findLatestOutreachEventId,
  shouldWriteImpactForStatus,
} from "../../../lib/outreach/complete-to-impact";
import type { OutreachAudience, OutreachCategory, OutreachStatus } from "../../../lib/outreach-calendar/types";

export type { OutreachCalendarView };

const OUTREACH_CATEGORIES: OutreachCategory[] = [
  "stem_demo",
  "mentoring",
  "community_event",
  "fundraising",
  "media",
  "other",
];
const OUTREACH_AUDIENCES: OutreachAudience[] = [
  "k12",
  "college",
  "public",
  "industry",
  "other_teams",
  "internal",
  "other",
];
const OUTREACH_STATUSES: OutreachStatus[] = ["planned", "confirmed", "completed", "canceled"];

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

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
      computeOutreachCalendarView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Outreach Calendar. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies OutreachCalendarView,
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
        case "create-event": {
          const title = trimmedOrNull(body.title, 200);
          const scheduledOn = isoDateOrNull(body.scheduledOn);
          if (!title) throw new Error("title is required");
          if (!scheduledOn) throw new Error("scheduledOn (YYYY-MM-DD) is required");
          const category = oneOf<OutreachCategory>(OUTREACH_CATEGORIES, body.category) ?? "community_event";
          const audience = oneOf<OutreachAudience>(OUTREACH_AUDIENCES, body.audience) ?? "public";
          const status = oneOf<OutreachStatus>(OUTREACH_STATUSES, body.status) ?? "planned";
          await createOutreachEvent(client, {
            orgId,
            userId,
            title,
            category,
            scheduledOn,
            status,
            audience,
            projectedHours: nonNegativeNumber(body.projectedHours),
            projectedPeopleReached: nonNegativeNumber(body.projectedPeopleReached),
            location: trimmedOrNull(body.location, 200),
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          if (shouldWriteImpactForStatus(status)) {
            const createdId = await findLatestOutreachEventId(client, { orgId, title, scheduledOn });
            if (createdId) {
              await completeOutreachEventToImpact(client, { orgId, userId, eventId: createdId });
            }
          }
          break;
        }
        case "complete": {
          const eventId = trimmedOrNull(body.eventId, 64);
          if (!eventId) throw new Error("eventId is required");
          await completeOutreachEventToImpact(client, { orgId, userId, eventId });
          break;
        }
        case "update-status": {
          const eventId = trimmedOrNull(body.eventId, 64);
          const status = oneOf<OutreachStatus>(OUTREACH_STATUSES, body.status);
          if (!eventId) throw new Error("eventId is required");
          if (!status) throw new Error("status is required");
          if (shouldWriteImpactForStatus(status)) {
            await completeOutreachEventToImpact(client, { orgId, userId, eventId });
          } else {
            await updateOutreachEventStatus(client, { orgId, eventId, status });
          }
          break;
        }
        case "delete-event": {
          const eventId = trimmedOrNull(body.eventId, 64);
          if (!eventId) throw new Error("eventId is required");
          await deleteOutreachEvent(client, { orgId, eventId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeOutreachCalendarView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof CompleteOutreachError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Outreach Calendar request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
