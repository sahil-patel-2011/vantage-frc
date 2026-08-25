import { randomUUID } from "node:crypto";
import {
  AIOrchestrator,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { createBridgeTransport } from "../../../lib/ai-bridge/transport";
import { headers } from "next/headers";
import {
  WRITER_USAGE_TAG,
  buildPitchBundle,
  parseAiPitchResponse,
  pitchDraftTitle,
} from "../../../lib/writer/ai-pitch";
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
import { loadOrgPitchContext } from "../../../lib/writer/load-pitch-context";
import type {
  DraftKind,
  DraftStatus,
  EmailKind,
  GrantFocus,
  GrantInput,
  SponsorInput,
  WriterTone,
} from "../../../lib/writer/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { WriterView };

const GRANT_FOCI: GrantFocus[] = ["general", "impact", "technical", "sustainability", "inclusion"];
const EMAIL_KINDS: EmailKind[] = ["cold_intro", "sponsorship_ask", "renewal", "thank_you", "grant_followup"];

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

function sponsorFromBody(body: Record<string, unknown>): SponsorInput {
  return {
    sponsorName: trimmedOrNull(body.sponsorName, 200) ?? "your organization",
    contactName: trimmedOrNull(body.contactName, 200),
    tier: trimmedOrNull(body.tier, 80),
    askAmountUsd: moneyOrNull(body.askAmountUsd),
    priorAmountUsd: moneyOrNull(body.priorAmountUsd),
    senderName: trimmedOrNull(body.senderName, 120),
    senderRole: trimmedOrNull(body.senderRole, 120),
  };
}

function grantFromBody(body: Record<string, unknown>): GrantInput {
  const charLimit = intOrNull(body.charLimit);
  return {
    prompt: trimmedOrNull(body.prompt, 4000) ?? "",
    charLimit,
    focus: oneOf<GrantFocus>(GRANT_FOCI, body.focus) ?? "general",
  };
}

/**
 * AI drafts call a real upstream model: give the function a 60s budget so the
 * adapter's own 50s timeout fires first and returns a classified error
 * instead of the platform killing the function mid-request.
 */
export const maxDuration = 60;

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
    const result = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query<{ orgName: string | null; teamNumber: number | null }>(
        `SELECT o.name AS "orgName", o.team_number AS "teamNumber"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.org_id = $1 AND m.user_id = $2`,
        [orgId, userId],
      );
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
        case "ai-draft": {
          const kind = oneOf<DraftKind>(DRAFT_KINDS, body.kind) ?? "sponsorship_ask";
          if (kind !== "grant" && !oneOf<EmailKind>(EMAIL_KINDS, kind)) {
            throw new Error("Invalid draft kind");
          }

          // Prefer live form profile fields when the client sends them; otherwise DB.
          if (trimmedOrNull(body.teamName, 200) || body.mission !== undefined || body.achievements !== undefined) {
            await setProfile(client, {
              orgId,
              userId,
              seasonYear,
              teamName: trimmedOrNull(body.teamName, 200) ?? "Our team",
              teamNumber: intOrNull(body.teamNumber) ?? member.rows[0]?.teamNumber ?? null,
              region: trimmedOrNull(body.region, 200),
              mission: trimmedOrNull(body.mission, 1000),
              achievements: stringsFrom(body.achievements),
              fundingNeed: trimmedOrNull(body.fundingNeed, 1000),
              fundingAskUsd: moneyOrNull(body.fundingAskUsd),
              tone: oneOf<WriterTone>(WRITER_TONES, body.tone) ?? "warm",
            });
          }

          const { profile, business } = await loadOrgPitchContext(client, {
            orgId,
            seasonYear,
            orgName: member.rows[0]?.orgName ?? null,
            teamNumber: member.rows[0]?.teamNumber ?? null,
          });

          // Overlay request profile when provided without a full save.
          const liveProfile = {
            ...profile,
            teamName: trimmedOrNull(body.teamName, 200) ?? profile.teamName,
            teamNumber: intOrNull(body.teamNumber) ?? profile.teamNumber,
            region: body.region === undefined ? profile.region : trimmedOrNull(body.region, 200),
            mission: body.mission === undefined ? profile.mission : trimmedOrNull(body.mission, 1000),
            achievements: body.achievements === undefined ? profile.achievements : stringsFrom(body.achievements),
            fundingNeed:
              body.fundingNeed === undefined ? profile.fundingNeed : trimmedOrNull(body.fundingNeed, 1000),
            fundingAskUsd:
              body.fundingAskUsd === undefined ? profile.fundingAskUsd : moneyOrNull(body.fundingAskUsd),
            tone: oneOf<WriterTone>(WRITER_TONES, body.tone) ?? profile.tone,
          };

          // Hard org-scope guard: business facts must match the RLS org.
          if (business.orgId !== orgId) throw new Error("Organization scope mismatch");

          const pitchInput = {
            kind,
            profile: liveProfile,
            sponsor: sponsorFromBody(body),
            grant: kind === "grant" ? grantFromBody(body) : null,
            business,
          };
          const bundle = buildPitchBundle(pitchInput);

          const promptCachingEnabled = await getOrgPromptCachingEnabled(client, orgId);
          // Honest setup_required (via ChatProviderResolutionError → failMeteredAi) when no
          // provider key — never invent essays via LocalDeterministicChatAdapter.
          const { adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
            orgId,
            promptCachingEnabled,
            feature: "writer",
            bridgeTransport: createBridgeTransport(),
          });

          const requestId = randomUUID();
          const run = await new AIOrchestrator(client).run({
            orgId,
            userId,
            requestId,
            capability: "writer",
            privacyScope: "team",
            message: bundle.message,
            adapter,
            contextSources: bundle.sources,
            usesOrgData: true,
            autoTools: false,
            promptCachingEnabled,
          });

          const parsed = parseAiPitchResponse(run.text, {
            subject: bundle.localSubject,
            body: bundle.localBody,
          });

          const subject = parsed.subject;
          const draftBody = parsed.body;
          const source = parsed.source;

          const targetName =
            kind === "grant"
              ? trimmedOrNull(body.prompt, 60) ?? "Grant answer"
              : trimmedOrNull(body.sponsorName, 200);

          const autoSave = body.save !== false;
          if (autoSave && draftBody.trim()) {
            await saveDraft(client, {
              orgId,
              userId,
              seasonYear,
              kind,
              title: pitchDraftTitle(kind, targetName),
              targetName,
              subject,
              body: draftBody,
              source,
            });
          }

          const view = await computeWriterView(client, { userId, requestedOrg: orgId, seasonYear });
          return {
            ...view,
            pitch: {
              subject,
              body: draftBody,
              source,
              kind,
              runId: run.runId,
              provider: run.provider,
              model: run.model,
              baseUrlOrigin: provenance.baseUrlOrigin,
              // `source` above is the draft's origin (ai vs template); this is
              // which key paid for the call, for the provenance chip.
              keySource: provenance.source,
              usageTag: WRITER_USAGE_TAG,
              orgScoped: true,
            },
          };
        }
        default:
          throw new Error("Unknown action");
      }

      return computeWriterView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(result);
  } catch (error) {
    return failMeteredAi(error, "Writing assistant request failed");
  }
}
