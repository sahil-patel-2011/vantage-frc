import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failDbWrite } from "../../../lib/db-error";
import {
  MATCH_NOTE_CATEGORIES,
  MATCH_NOTE_PHASES,
  computeMatchNotesTimelineView,
  currentSeasonYear,
  deleteMatchNote,
  logMatchNote,
  type MatchNotesTimelineView,
} from "../../../lib/match-notes-timeline/compute-match-notes-timeline";
import type { MatchNoteCategory, MatchNotePhase } from "../../../lib/match-notes-timeline/types";

export type { MatchNotesTimelineView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function intOrNull(value: unknown): number | null {
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
      computeMatchNotesTimelineView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the match note timeline. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MatchNotesTimelineView,
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
        case "log-note": {
          const matchLabel = trimmedOrNull(body.matchLabel, 120);
          const note = trimmedOrNull(body.note, 2000);
          if (!matchLabel) throw new Error("matchLabel is required");
          if (!note) throw new Error("note is required");
          const phase = oneOf<MatchNotePhase>(MATCH_NOTE_PHASES, body.phase) ?? "teleop";
          const category = oneOf<MatchNoteCategory>(MATCH_NOTE_CATEGORIES, body.category) ?? "observation";
          await logMatchNote(client, {
            orgId,
            userId,
            matchLabel,
            matchKey: trimmedOrNull(body.matchKey, 64),
            teamNumber: intOrNull(body.teamNumber),
            phase,
            category,
            clockSeconds: nonNegativeInt(body.clockSeconds),
            note,
            seasonYear,
          });
          break;
        }
        case "delete-note": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteMatchNote(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchNotesTimelineView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    // Rows here are keyed to an event/match that references events_ref, so an
    // event not yet ingested from TBA raised a 23503 whose raw constraint text
    // went straight to the user. failDbWrite names the fix, and keeps the
    // previous behaviour for every other error.
    return failDbWrite(error, "Match note timeline request failed");
  }
}
