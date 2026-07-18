import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DRAFT_KINDS,
  DRAFT_STATUSES,
  WRITER_TONES,
  computeWriterView,
  currentSeasonYear,
  deleteDraft,
  saveDraft,
  setProfile,
  updateDraft,
  type WriterView,
} from "../../../lib/writer/compute-writer";
import type { DraftKind, DraftStatus, WriterTone } from "../../../lib/writer/types";

export type { WriterView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 8000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function stringsFrom(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  return raw
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(0, 300))
    .slice(0, 12);
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
      computeWriterView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the writing assistant. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies WriterView,
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
        case "set-profile": {
          await setProfile(client, {
            orgId,
            userId,
            seasonYear,
            teamName: trimmedOrNull(body.teamName, 200) ?? "Our team",
            teamNumber: intOrNull(body.teamNumber),
            region: trimmedOrNull(body.region, 200),
            mission: trimmedOrNull(body.mission, 1000),
            achievements: stringsFrom(body.achievements),
            fundingNeed: trimmedOrNull(body.fundingNeed, 1000),
            fundingAskUsd: moneyOrNull(body.fundingAskUsd),
            tone: oneOf<WriterTone>(WRITER_TONES, body.tone) ?? "warm",
          });
          break;
        }
        case "save-draft": {
          const kind = oneOf<DraftKind>(DRAFT_KINDS, body.kind);
          const draftBody = trimmedOrNull(body.body, 20000);
          if (!kind) throw new Error("Invalid draft kind");
          if (!draftBody) throw new Error("body is required");
          await saveDraft(client, {
            orgId,
            userId,
            seasonYear,
            kind,
            title: trimmedOrNull(body.title, 200) ?? "Untitled draft",
            targetName: trimmedOrNull(body.targetName, 200),
            subject: trimmedOrNull(body.subject, 300),
            body: draftBody,
            source: trimmedOrNull(body.source, 20) ?? "template",
          });
          break;
        }
        case "update-draft": {
          const draftId = trimmedOrNull(body.draftId, 64);
          if (!draftId) throw new Error("draftId is required");
          const status = body.status === undefined ? undefined : oneOf<DraftStatus>(DRAFT_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateDraft(client, {
            orgId,
            draftId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            subject: body.subject === undefined ? undefined : trimmedOrNull(body.subject, 300),
            body: body.body === undefined ? undefined : (trimmedOrNull(body.body, 20000) ?? undefined),
            status: status ?? undefined,
          });
          break;
        }
        case "delete-draft": {
          const draftId = trimmedOrNull(body.draftId, 64);
          if (!draftId) throw new Error("draftId is required");
          await deleteDraft(client, { orgId, draftId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeWriterView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Writing assistant request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
