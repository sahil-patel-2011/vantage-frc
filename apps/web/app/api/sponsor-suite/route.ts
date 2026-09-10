import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeSponsorSuiteView,
  createReminder,
  currentSeasonYear,
  deleteDeck,
  generateDeck,
  generateRoiReport,
  setGoal,
  updateReminderStatus,
  type SponsorSuiteView,
} from "../../../lib/sponsor-suite/compute-sponsor-suite";
import type { SponsorSuiteDeckKind, SponsorSuiteReminderKind } from "../../../lib/sponsor-suite/types";

export type { SponsorSuiteView };

const DECK_KINDS: SponsorSuiteDeckKind[] = ["pitch", "renewal"];
const REMINDER_KINDS: SponsorSuiteReminderKind[] = ["thank_you", "renewal"];

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

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
      computeSponsorSuiteView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Sponsor Suite. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SponsorSuiteView,
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
        case "generate-deck": {
          const kind = oneOf<SponsorSuiteDeckKind>(DECK_KINDS, body.kind) ?? "pitch";
          const sponsorId = trimmedOrNull(body.sponsorId, 64);
          await generateDeck(client, { orgId, userId, sponsorId, kind, seasonYear });
          break;
        }
        case "delete-deck": {
          const deckId = trimmedOrNull(body.deckId, 64);
          if (!deckId) throw new Error("deckId is required");
          await deleteDeck(client, { orgId, deckId });
          break;
        }
        case "generate-roi-report": {
          await generateRoiReport(client, { orgId, userId, seasonYear });
          break;
        }
        case "set-goal": {
          const goalUsd = positiveNumber(body.goalUsd);
          if (goalUsd == null) throw new Error("goalUsd must be a non-negative number");
          await setGoal(client, { orgId, userId, seasonYear, goalUsd });
          break;
        }
        case "create-reminder": {
          const sponsorId = trimmedOrNull(body.sponsorId, 64);
          const dueOn = isoDateOrNull(body.dueOn);
          const kind = oneOf<SponsorSuiteReminderKind>(REMINDER_KINDS, body.kind);
          if (!sponsorId) throw new Error("sponsorId is required");
          if (!dueOn) throw new Error("dueOn (YYYY-MM-DD) is required");
          if (!kind) throw new Error("kind must be thank_you or renewal");
          await createReminder(client, { orgId, userId, sponsorId, kind, dueOn, note: trimmedOrNull(body.note, 2000) });
          break;
        }
        case "resolve-reminder": {
          const reminderId = trimmedOrNull(body.reminderId, 64);
          const status = oneOf<"sent" | "dismissed">(["sent", "dismissed"], body.status);
          if (!reminderId) throw new Error("reminderId is required");
          if (!status) throw new Error("status must be sent or dismissed");
          await updateReminderStatus(client, { orgId, reminderId, status });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSponsorSuiteView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sponsor Suite request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
