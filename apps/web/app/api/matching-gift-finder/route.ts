import type { RenderOutcome } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { MATCHING_GIFT_PLEDGE_STATUSES, MATCHING_GIFT_RELATIONSHIPS } from "../../../lib/matching-gift-finder";
import {
  addContact,
  addProgram,
  computeMatchingGiftFinderView,
  currentSeasonYear,
  deleteContact,
  deleteDraft,
  deletePledge,
  deleteProgram,
  generateDraftLetter,
  updateContact,
  upsertPledge,
  type MatchingGiftFinderView,
} from "../../../lib/matching-gift-finder/compute-matching-gift-finder";
import type { MatchingGiftPledgeStatus, MatchingGiftRelationship } from "../../../lib/matching-gift-finder/types";

export type { MatchingGiftFinderView };

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

function nonNegativeNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
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
      computeMatchingGiftFinderView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Matching Gift Finder. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies MatchingGiftFinderView,
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

      let render: RenderOutcome | undefined;
      switch (action) {
        case "add-contact": {
          const fullName = trimmedOrNull(body.fullName, 200);
          if (!fullName) throw new Error("fullName is required");
          const relationship = oneOf<MatchingGiftRelationship>(MATCHING_GIFT_RELATIONSHIPS, body.relationship) ?? "parent";
          await addContact(client, {
            orgId,
            userId,
            fullName,
            relationship,
            employerName: trimmedOrNull(body.employerName, 200),
            email: trimmedOrNull(body.email, 200),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-contact": {
          const contactId = trimmedOrNull(body.contactId, 64);
          if (!contactId) throw new Error("contactId is required");
          await updateContact(client, {
            orgId,
            contactId,
            employerName: trimmedOrNull(body.employerName, 200),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-contact": {
          const contactId = trimmedOrNull(body.contactId, 64);
          if (!contactId) throw new Error("contactId is required");
          await deleteContact(client, { orgId, contactId });
          break;
        }
        case "add-program": {
          const employerName = trimmedOrNull(body.employerName, 200);
          if (!employerName) throw new Error("employerName is required");
          await addProgram(client, {
            orgId,
            userId,
            employerName,
            matchRatio: trimmedOrNull(body.matchRatio, 40) ?? "1:1",
            minGiftUsd: nonNegativeNumberOrNull(body.minGiftUsd),
            maxGiftUsd: nonNegativeNumberOrNull(body.maxGiftUsd),
            annualDeadline: trimmedOrNull(body.annualDeadline, 200),
            submissionUrl: trimmedOrNull(body.submissionUrl, 500),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-program": {
          const programId = trimmedOrNull(body.programId, 64);
          if (!programId) throw new Error("programId is required");
          await deleteProgram(client, { orgId, programId });
          break;
        }
        case "upsert-pledge": {
          const contactId = trimmedOrNull(body.contactId, 64);
          const programId = trimmedOrNull(body.programId, 64);
          const status = oneOf<MatchingGiftPledgeStatus>(MATCHING_GIFT_PLEDGE_STATUSES, body.status) ?? "identified";
          if (!contactId) throw new Error("contactId is required");
          if (!programId) throw new Error("programId is required");
          await upsertPledge(client, {
            orgId,
            userId,
            contactId,
            programId,
            status,
            pledgeAmountUsd: nonNegativeNumberOrNull(body.pledgeAmountUsd),
            requestedOn: isoDateOrNull(body.requestedOn),
            resolvedOn: isoDateOrNull(body.resolvedOn),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-pledge": {
          const pledgeId = trimmedOrNull(body.pledgeId, 64);
          if (!pledgeId) throw new Error("pledgeId is required");
          await deletePledge(client, { orgId, pledgeId });
          break;
        }
        case "generate-draft": {
          const contactId = trimmedOrNull(body.contactId, 64);
          const programId = trimmedOrNull(body.programId, 64);
          if (!contactId) throw new Error("contactId is required");
          if (!programId) throw new Error("programId is required");
          render = (await generateDraftLetter(client, { orgId, userId, contactId, programId, seasonYear })).render ?? undefined;
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

      const view = await computeMatchingGiftFinderView(client, { userId, requestedOrg: orgId, seasonYear });
      return render ? { ...view, render } : view;
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Matching Gift Finder request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
