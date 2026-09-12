import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  MOCK_JUDGING_AWARD_CATEGORIES,
  computeMockJudgingView,
  currentSeasonYear,
  deletePrepNote,
  deleteSession,
  logPrepNote,
  runSession,
  type MockJudgingView,
} from "../../../lib/mock-judging/compute-mock-judging";
import type { MockJudgingAwardCategory } from "../../../lib/mock-judging/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { MockJudgingView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function stringArray(value: unknown, max = 20, maxLen = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, maxLen))
    .slice(0, max);
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
      computeMockJudgingView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Mock Judging. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MockJudgingView,
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
          const title = trimmedOrNull(body.title, 200);
          const note = trimmedOrNull(body.note, 2000);
          if (!title) throw new Error("title is required");
          if (!note) throw new Error("note is required");
          const awardCategory =
            oneOf<MockJudgingAwardCategory>(MOCK_JUDGING_AWARD_CATEGORIES, body.awardCategory) ?? "general";
          await logPrepNote(client, {
            orgId,
            userId,
            title,
            note,
            awardCategory,
            tags: stringArray(body.tags),
          });
          break;
        }
        case "delete-note": {
          const noteId = trimmedOrNull(body.noteId, 64);
          if (!noteId) throw new Error("noteId is required");
          await deletePrepNote(client, { orgId, noteId });
          break;
        }
        case "run-session": {
          const answerText = trimmedOrNull(body.answerText, 4000);
          if (!answerText) throw new Error("answerText is required");
          const awardCategory =
            oneOf<MockJudgingAwardCategory>(MOCK_JUDGING_AWARD_CATEGORIES, body.awardCategory) ?? "general";
          await runSession(client, {
            orgId,
            userId,
            seasonYear,
            awardCategory,
            question: trimmedOrNull(body.question, 500),
            answerText,
          });
          break;
        }
        case "delete-session": {
          const sessionId = trimmedOrNull(body.sessionId, 64);
          if (!sessionId) throw new Error("sessionId is required");
          await deleteSession(client, { orgId, sessionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMockJudgingView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Mock Judging request failed");
  }
}
