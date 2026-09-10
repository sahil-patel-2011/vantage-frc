import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import { headers } from "next/headers";
import {
  SCOUT_VOICE_CONSENT_COPY,
  SCOUT_VOICE_CONSENT_VERSION,
} from "../../../lib/scout-voice";
import {
  attachVoiceNote,
  computeScoutVoiceView,
  deleteVoiceNote,
  setOrgVoiceOptIn,
  setUserVoiceOptIn,
  transcribeWithCloudStt,
  type ScoutVoiceView,
} from "../../../lib/scout-voice/compute-scout-voice";
import type { ScoutVoiceSttSource } from "../../../lib/scout-voice/types";

export type { ScoutVoiceView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asSttSource(value: unknown): ScoutVoiceSttSource {
  if (value === "cloud" || value === "manual" || value === "browser") return value;
  return "browser";
}

function setupRequiredFallback(orgId: string | null, message: string): ScoutVoiceView {
  return {
    status: "setup_required",
    message,
    steps: [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Pick which FRC team you are working as.",
        href: "/workspace",
      },
      {
        id: "stt-provider",
        label: "Configure STT provider",
        detail: "Set OPENAI_API_KEY for cloud Whisper, or use browser speech recognition",
        href: "/team/ai-policy",
      },
    ],
    orgId,
    canManageOrg: false,
    consent: SCOUT_VOICE_CONSENT_COPY,
    consentVersion: SCOUT_VOICE_CONSENT_VERSION,
    providers: { cloudConfigured: false, cloudProvider: null },
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const eventKey = url.searchParams.get("eventKey");
  const entryClientId = url.searchParams.get("entryClientId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeScoutVoiceView(client, {
        userId: session.user.id,
        requestedOrg,
        eventKey,
        entryClientId,
      }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      setupRequiredFallback(
        null,
        "Could not load scouting voice notes. Select a team and confirm database access.",
      ),
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
  const eventKey = trimmedOrNull(body.eventKey, 64);
  const entryClientId = trimmedOrNull(body.entryClientId, 64);

  try {
    if (action === "transcribe") {
      const audioBase64 = trimmedOrNull(body.audioBase64, 40_000_000);
      const contentType = trimmedOrNull(body.contentType, 120) ?? "audio/webm";
      if (!audioBase64) return Response.json({ error: "audioBase64 is required" }, { status: 400 });

      const result = await withRls({ userId, orgId }, async (client) => {
        const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
          orgId,
          userId,
        ]);
        if (!member.rowCount) throw new Error("forbidden");
        return transcribeWithCloudStt(client, {
          orgId,
          userId,
          audioBase64,
          contentType,
          fileName: trimmedOrNull(body.fileName, 120) ?? undefined,
        });
      });
      return Response.json({ status: "ok", ...result });
    }

    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");
      const role = member.rows[0]?.role ?? "viewer";
      const canManageOrg = role === "owner" || role === "admin";

      switch (action) {
        case "set-org-opt-in": {
          if (!canManageOrg) throw new Error("Only owners and admins can enable team voice notes");
          await setOrgVoiceOptIn(client, {
            orgId,
            userId,
            enabled: Boolean(body.enabled),
            acceptConsent: Boolean(body.acceptConsent),
          });
          break;
        }
        case "set-user-opt-in": {
          await setUserVoiceOptIn(client, {
            orgId,
            userId,
            enabled: Boolean(body.enabled),
            acceptConsent: Boolean(body.acceptConsent),
          });
          break;
        }
        case "attach-note": {
          const transcript = trimmedOrNull(body.transcript, 20_000);
          const teamKey = trimmedOrNull(body.teamKey, 32);
          const noteEventKey = trimmedOrNull(body.eventKey, 64);
          if (!transcript || !teamKey || !noteEventKey) {
            throw new Error("eventKey, teamKey, and transcript are required");
          }
          await attachVoiceNote(client, {
            orgId,
            userId,
            eventKey: noteEventKey,
            matchKey: trimmedOrNull(body.matchKey, 64),
            teamKey,
            entryType: body.entryType === "pit" ? "pit" : "match",
            entryClientId: trimmedOrNull(body.entryClientId, 64),
            entryId: trimmedOrNull(body.entryId, 64),
            mediaClientId: trimmedOrNull(body.mediaClientId, 64),
            transcript,
            sttSource: asSttSource(body.sttSource),
          });
          break;
        }
        case "delete-note": {
          const noteId = trimmedOrNull(body.noteId, 64);
          if (!noteId) throw new Error("noteId is required");
          await deleteVoiceNote(client, { orgId, noteId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutVoiceView(client, {
        userId,
        requestedOrg: orgId,
        eventKey,
        entryClientId,
      });
    });

    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const message = error instanceof Error ? error.message : "Scout voice request failed";
    if (message.startsWith("setup_required:")) {
      return Response.json(setupRequiredFallback(orgId, message.replace(/^setup_required:\s*/, "")), {
        status: 200,
      });
    }
    return failMeteredAi(error, "Scout voice request failed");
  }
}
