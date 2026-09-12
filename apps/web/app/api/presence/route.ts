/**
 * /api/presence — the one presence record: RSVP -> roll call -> hours.
 *
 * GET returns the reconciled view for one calendar occurrence (event + date).
 * POST performs the four EXPLICIT linking actions. Nothing here ever infers a
 * signal it was not given: an RSVP never becomes attendance, attendance never
 * becomes an RSVP, and a member with no signal is simply absent from the rows.
 *
 * Every write runs inside the caller's `withRls` transaction (BEGIN/COMMIT is
 * withRls itself), so when two tables move together they land together.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computePresenceView,
  deletePresenceRecord,
  isPresenceDate,
  linkAttendancePerson,
  linkHourLog,
  todayIsoDate,
  unlinkHourLog,
  upsertPresenceRecord,
  type PresenceView,
} from "../../../lib/presence/compute-presence";
import { PRESENCE_RSVPS, PRESENCE_SOURCES, type PresenceRsvp, type PresenceSource } from "../../../lib/presence/types";
import {
  assertCanManagePresence,
  assertCanRecordPresence,
  assertCanTouchHourLog,
  assertRosterMember,
  loadHourLogOwner,
  PresenceAuthError,
  requirePresenceRole,
} from "../../../lib/presence/authorization";

export type { PresenceView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function minutesOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function setupFallback(presenceDate: string): PresenceView {
  return {
    status: "setup_required",
    message:
      "Could not load presence. Choose your team and confirm database access — nothing has been assumed about who was here.",
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      {
        id: "calendar",
        label: "Add a meeting to the calendar",
        detail: "Presence hangs off a calendar occurrence — a date on its own has nothing to reconcile.",
        href: "/team/calendar",
      },
    ],
    orgId: null,
    presenceDate,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const rawDate = url.searchParams.get("date");
  const presenceDate = isPresenceDate(rawDate) ? rawDate : todayIsoDate();
  const eventId = url.searchParams.get("eventId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePresenceView(client, {
        userId: session.user.id,
        requestedOrg,
        presenceDate,
        eventId,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(setupFallback(presenceDate), { status: 200 });
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
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const action = typeof body.action === "string" ? body.action : "";
  const presenceDate = isPresenceDate(body.date) ? (body.date as string) : todayIsoDate();
  const eventId = trimmedOrNull(body.eventId, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const role = await requirePresenceRole(client, orgId, userId);

      switch (action) {
        case "link-attendance-person": {
          // Writing an identity onto a roll-call row is a mentor action (attendance_entries RLS
          // agrees), and it is only ever taken after a human confirmed the match.
          assertCanManagePresence({ role, action: "link-attendance-person" });
          const personName = trimmedOrNull(body.personName, 160);
          if (!personName) throw new Error("personName is required");
          const targetUserId = trimmedOrNull(body.targetUserId, 64);
          if (targetUserId) await assertRosterMember(client, orgId, targetUserId);
          const linked = await linkAttendancePerson(client, { orgId, personName, userId: targetUserId });
          if (linked === 0) throw new Error("No roll-call entries matched that name.");
          break;
        }

        case "record-presence": {
          if (!eventId) throw new Error("eventId is required");
          // One member, or the whole reconciled screen in a single transaction
          // (the "save this meeting" primary action). Either all rows land or none do.
          const batch = Array.isArray(body.records)
            ? (body.records as Record<string, unknown>[])
            : [body];
          if (batch.length === 0) throw new Error("Nothing to record.");
          if (batch.length > 200) throw new Error("Too many rows in one request.");

          for (const entry of batch) {
            const targetUserId = trimmedOrNull(entry.targetUserId, 64);
            if (!targetUserId) throw new Error("targetUserId is required");
            assertCanRecordPresence({ role, actorId: userId, targetUserId });
            await assertRosterMember(client, orgId, targetUserId);
            await upsertPresenceRecord(client, {
              orgId,
              userId: targetUserId,
              calendarEventId: eventId,
              occurrenceDate: presenceDate,
              // null stays null on purpose — "not answered" and "no roll call"
              // are real states, never coerced into "no" or "absent".
              rsvp: oneOf<PresenceRsvp>(PRESENCE_RSVPS, entry.rsvp),
              attended: boolOrNull(entry.attended),
              hourLogId: trimmedOrNull(entry.hourLogId, 64),
              minutes: minutesOrNull(entry.minutes),
              source: oneOf<PresenceSource>(PRESENCE_SOURCES, entry.source) ?? "manual",
              note: trimmedOrNull(entry.note, 500) ?? "",
              recordedBy: userId,
            });
          }
          break;
        }

        case "link-hour-log": {
          if (!eventId) throw new Error("eventId is required");
          const hourLogId = trimmedOrNull(body.hourLogId, 64);
          if (!hourLogId) throw new Error("hourLogId is required");
          const logOwner = await loadHourLogOwner(client, orgId, hourLogId);
          assertCanTouchHourLog({ role, actorId: userId, ownerId: logOwner, verb: "attach" });
          const linked = await linkHourLog(client, {
            orgId,
            hourLogId,
            calendarEventId: eventId,
            occurrenceDate: presenceDate,
          });
          if (linked === 0) throw new Error("That shop session could not be attached.");
          break;
        }

        case "unlink-hour-log": {
          const hourLogId = trimmedOrNull(body.hourLogId, 64);
          if (!hourLogId) throw new Error("hourLogId is required");
          const logOwner = await loadHourLogOwner(client, orgId, hourLogId);
          assertCanTouchHourLog({ role, actorId: userId, ownerId: logOwner, verb: "detach" });
          await unlinkHourLog(client, { orgId, hourLogId });
          break;
        }

        case "unlink-presence": {
          assertCanManagePresence({ role, action: "unlink-presence" });
          if (!eventId) throw new Error("eventId is required");
          const targetUserId = trimmedOrNull(body.targetUserId, 64);
          if (!targetUserId) throw new Error("targetUserId is required");
          await assertRosterMember(client, orgId, targetUserId);
          await deletePresenceRecord(client, {
            orgId,
            userId: targetUserId,
            calendarEventId: eventId,
            occurrenceDate: presenceDate,
          });
          break;
        }

        default:
          throw new Error("Unknown action");
      }

      return computePresenceView(client, {
        userId,
        requestedOrg: orgId,
        presenceDate,
        eventId,
      });
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof PresenceAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Presence request failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
