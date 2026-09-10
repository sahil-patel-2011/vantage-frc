import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DECISION_SEARCH_SOURCE_KINDS,
  computeDecisionSearchView,
  currentSeasonYear,
  deleteDocument,
  importDecisionRecords,
  indexDocument,
  runSearch,
  type DecisionSearchView,
} from "../../../lib/decision-search/compute-decision-search";
import type { DecisionSearchSourceKind } from "../../../lib/decision-search/types";

export type { DecisionSearchView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
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
      computeDecisionSearchView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Decision Search. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DecisionSearchView,
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
        case "index-document": {
          const title = trimmedOrNull(body.title, 200);
          const bodyText = trimmedOrNull(body.body, 8000);
          const sourceId = trimmedOrNull(body.sourceId, 200);
          if (!title) throw new Error("title is required");
          if (!bodyText) throw new Error("body is required");
          if (!sourceId) throw new Error("sourceId is required");
          const sourceKind =
            oneOf<DecisionSearchSourceKind>(DECISION_SEARCH_SOURCE_KINDS, body.sourceKind) ?? "notebook_entry";
          const tags = Array.isArray(body.tags)
            ? body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 40)).filter(Boolean)
            : [];
          await indexDocument(client, {
            orgId,
            userId,
            sourceKind,
            sourceId,
            title,
            body: bodyText,
            seasonYear,
            tags,
          });
          break;
        }
        case "delete-document": {
          const documentId = trimmedOrNull(body.documentId, 64);
          if (!documentId) throw new Error("documentId is required");
          await deleteDocument(client, { orgId, documentId });
          break;
        }
        case "import-decisions": {
          await importDecisionRecords(client, { orgId, userId, seasonYear });
          break;
        }
        case "search": {
          const queryText = trimmedOrNull(body.queryText, 400);
          if (!queryText) throw new Error("queryText is required");
          await runSearch(client, { orgId, userId, seasonYear, queryText });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDecisionSearchView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decision Search request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
