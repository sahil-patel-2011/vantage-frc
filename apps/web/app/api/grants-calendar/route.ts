// Grant calendar API. Session-gated, org-scoped through `withRls` — the SELECT policy in
// migration 0458 is what actually decides which rows come back (platform rows plus this
// team's own), and the owner/admin write policies are what actually reject a student's POST.
// Nothing here can write a platform row: no policy grants it to vantage_app.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addTeamOpportunity,
  computeGrantCalendarView,
  removeTeamOpportunity,
  setEligibilityFacts,
  setWatch,
} from "../../../lib/grants-calendar/compute-grants-calendar";

export const runtime = "nodejs";

type JsonBody = Record<string, unknown>;

const ACTIONS = [
  "set-watch",
  "add-opportunity",
  "remove-opportunity",
  "set-eligibility-facts",
] as const;
type Action = (typeof ACTIONS)[number];

function text(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function webUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

/** `null` stays `null`. An unanswered eligibility question must never collapse to `false`. */
function tristate(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "unknown" || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** Missing tables mean the migration has not run — that is setup, not a crash. */
function migrationPending(error: unknown): boolean {
  return (
    error instanceof Error &&
    /grant_calendar_opportunities|grant_calendar_watchlist|title_i|nonprofit_501c3/.test(
      error.message,
    )
  );
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls(
      { userId: session.user.id, orgId: requestedOrg ?? undefined },
      (client) =>
        computeGrantCalendarView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch (error) {
    if (migrationPending(error)) {
      return Response.json({
        status: "setup_required",
        message:
          "The grant calendar migration has not been applied to this database yet. Deadlines appear once it runs.",
        steps: [],
        orgId: null,
      });
    }
    return Response.json({ error: "Could not load the grant calendar." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = text(body.orgId, 64);
  const action = body.action;
  if (!orgId || !isAction(action)) {
    return Response.json({ error: "orgId and a valid action are required" }, { status: 400 });
  }

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      switch (action) {
        case "set-watch": {
          const opportunityId = text(body.opportunityId, 64);
          if (!opportunityId) throw new Error("bad_request:opportunityId is required");
          await setWatch(client, {
            orgId,
            userId: session.user.id,
            opportunityId,
            watching: body.watching !== false,
            // Watching without alerts is a legitimate choice; default the toggle ON only
            // because a watch whose whole point is the deadline email should behave that way.
            notify: body.notify !== false,
          });
          break;
        }
        case "add-opportunity": {
          const name = text(body.name, 200);
          const funder = text(body.funder, 200);
          if (!name || !funder) {
            throw new Error("bad_request:Grant name and funder are required");
          }
          const opensOn = isoDate(body.opensOn);
          const closesOn = isoDate(body.closesOn);
          if (opensOn && closesOn && closesOn < opensOn) {
            throw new Error("bad_request:The close date cannot be before the open date");
          }
          await addTeamOpportunity(client, {
            orgId,
            userId: session.user.id,
            name,
            funder,
            url: webUrl(body.url),
            opensOn,
            closesOn,
            typicalAmountUsd: money(body.typicalAmountUsd),
            notes: text(body.notes, 4_000),
          });
          break;
        }
        case "remove-opportunity": {
          const opportunityId = text(body.opportunityId, 64);
          if (!opportunityId) throw new Error("bad_request:opportunityId is required");
          await removeTeamOpportunity(client, { orgId, opportunityId });
          break;
        }
        case "set-eligibility-facts": {
          await setEligibilityFacts(client, {
            orgId,
            userId: session.user.id,
            titleI: tristate(body.titleI),
            nonprofit501c3: tristate(body.nonprofit501c3),
          });
          break;
        }
      }
      return computeGrantCalendarView(client, {
        userId: session.user.id,
        requestedOrg: orgId,
      });
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("bad_request:")) {
      return Response.json({ error: message.slice("bad_request:".length) }, { status: 400 });
    }
    // RLS rejects the write rather than the API guessing at roles — surface it as a 403.
    if (/row-level security|permission denied|violates row-level/i.test(message)) {
      return Response.json(
        { error: "Only a team owner or admin can change the grant calendar." },
        { status: 403 },
      );
    }
    if (migrationPending(error)) {
      return Response.json(
        { error: "The grant calendar migration has not been applied to this database yet." },
        { status: 503 },
      );
    }
    return Response.json({ error: "Could not update the grant calendar." }, { status: 500 });
  }
}
