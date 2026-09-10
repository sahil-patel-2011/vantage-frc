import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { meteredAI } from "@vantage/billing";
import { isSttUnsupportedStatus, resolveOrgSttEndpoint } from "@vantage/agent";
import { resolveScoutOrg } from "../scout-org-access";
import {
  estimateCloudSttCostUsd,
  isScoutVoiceFullyEnabled,
  SCOUT_VOICE_CONSENT_COPY,
  SCOUT_VOICE_CONSENT_VERSION,
  SCOUT_VOICE_STT_FEATURE,
} from ".";
import type {
  ScoutVoiceNote,
  ScoutVoiceOrgSettings,
  ScoutVoiceProviders,
  ScoutVoiceSttSource,
  ScoutVoiceUserPrefs,
} from "./types";

export type ScoutVoiceSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutVoiceView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutVoiceSetupStep[];
      orgId: string | null;
      canManageOrg: boolean;
      consent: typeof SCOUT_VOICE_CONSENT_COPY;
      consentVersion: string;
      providers: ScoutVoiceProviders;
    }
  | {
      status: "opt_in_required";
      message: string;
      orgId: string;
      canManageOrg: boolean;
      orgSettings: ScoutVoiceOrgSettings;
      userPrefs: ScoutVoiceUserPrefs;
      consent: typeof SCOUT_VOICE_CONSENT_COPY;
      consentVersion: string;
      providers: ScoutVoiceProviders;
      notes: ScoutVoiceNote[];
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      canManageOrg: boolean;
      orgSettings: ScoutVoiceOrgSettings;
      userPrefs: ScoutVoiceUserPrefs;
      consent: typeof SCOUT_VOICE_CONSENT_COPY;
      consentVersion: string;
      providers: ScoutVoiceProviders;
      notes: ScoutVoiceNote[];
      computedAt: string;
    };

export async function detectCloudSttProvider(
  client: PoolClient,
  orgId: string,
  userId?: string,
): Promise<ScoutVoiceProviders> {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return { cloudConfigured: true, cloudProvider: "openai" };
  }

  const keys = await client.query(
    `SELECT 1
     FROM org_llm_keys
     WHERE org_id = $1 AND lower(provider) LIKE '%openai%'
     LIMIT 1`,
    [orgId],
  );
  if (keys.rowCount) {
    return { cloudConfigured: true, cloudProvider: "openai" };
  }

  if (userId) {
    // member_llm_keys may not exist yet before migration; savepointed so a missing
    // table costs this one probe instead of aborting the transaction the rest of
    // the Scout Voice view is read on.
    const memberKeys = await withSavepoint(
      client,
      async () =>
        (
          await client.query(
            `SELECT 1
             FROM member_llm_keys
             WHERE org_id = $1::uuid AND user_id = $2::uuid AND lower(provider) LIKE '%openai%'
             LIMIT 1`,
            [orgId, userId],
          )
        ).rowCount,
      0,
    );
    if (memberKeys) {
      return { cloudConfigured: true, cloudProvider: "openai" };
    }
  }

  // OpenAI-compatible connector base URL (Ollama / LM Studio / LocalAI …) — key
  // optional; whether the endpoint actually supports /audio/transcriptions is
  // verified honestly at transcription time.
  const configs = await client.query(
    `SELECT 1
     FROM org_provider_configs
     WHERE org_id = $1
       AND enabled = true
       AND disabled_at IS NULL
       AND local_relay = false
       AND base_url IS NOT NULL
       AND (lower(kind) LIKE '%openai%' OR lower(coalesce(kind,'')) LIKE '%compatible%')
     LIMIT 1`,
    [orgId],
  );
  if (configs.rowCount) {
    return { cloudConfigured: true, cloudProvider: "openai-compatible" };
  }

  return { cloudConfigured: false, cloudProvider: null };
}

function mapNote(row: {
  id: string;
  eventKey: string;
  matchKey: string | null;
  teamKey: string;
  entryType: string;
  entryClientId: string | null;
  entryId: string | null;
  mediaClientId: string | null;
  transcript: string;
  sttSource: string;
  consentAckVersion: string;
  createdBy: string;
  createdAt: string;
}): ScoutVoiceNote {
  const sttSource: ScoutVoiceSttSource =
    row.sttSource === "cloud" || row.sttSource === "manual" ? row.sttSource : "browser";
  return {
    id: row.id,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    teamKey: row.teamKey,
    entryType: row.entryType === "pit" ? "pit" : "match",
    entryClientId: row.entryClientId,
    entryId: row.entryId,
    mediaClientId: row.mediaClientId,
    transcript: row.transcript,
    sttSource,
    consentAckVersion: row.consentAckVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

async function loadNotes(
  client: PoolClient,
  orgId: string,
  filter?: { eventKey?: string | null; entryClientId?: string | null },
): Promise<ScoutVoiceNote[]> {
  const result = await client.query<{
    id: string;
    eventKey: string;
    matchKey: string | null;
    teamKey: string;
    entryType: string;
    entryClientId: string | null;
    entryId: string | null;
    mediaClientId: string | null;
    transcript: string;
    sttSource: string;
    consentAckVersion: string;
    createdBy: string;
    createdAt: string;
  }>(
    `SELECT id, event_key AS "eventKey", match_key AS "matchKey", team_key AS "teamKey",
            entry_type AS "entryType", entry_client_id AS "entryClientId", entry_id AS "entryId",
            media_client_id AS "mediaClientId", transcript, stt_source AS "sttSource",
            consent_ack_version AS "consentAckVersion", created_by AS "createdBy",
            created_at::text AS "createdAt"
     FROM scout_voice_notes
     WHERE org_id = $1
       AND ($2::text IS NULL OR event_key = $2)
       AND ($3::text IS NULL OR entry_client_id = $3)
     ORDER BY created_at DESC
     LIMIT 50`,
    [orgId, filter?.eventKey ?? null, filter?.entryClientId ?? null],
  );
  return result.rows.map(mapNote);
}

async function loadOrgSettings(
  client: PoolClient,
  orgId: string,
): Promise<ScoutVoiceOrgSettings> {
  const result = await client.query<{
    enabled: boolean;
    consentAckVersion: string | null;
    acceptedAt: string | null;
    acceptedBy: string | null;
  }>(
    `SELECT enabled, consent_ack_version AS "consentAckVersion",
            accepted_at::text AS "acceptedAt", accepted_by::text AS "acceptedBy"
     FROM scout_voice_org_settings WHERE org_id = $1`,
    [orgId],
  );
  const row = result.rows[0];
  return {
    enabled: Boolean(row?.enabled),
    consentAckVersion: row?.consentAckVersion ?? null,
    acceptedAt: row?.acceptedAt ?? null,
    acceptedBy: row?.acceptedBy ?? null,
  };
}

async function loadUserPrefs(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<ScoutVoiceUserPrefs> {
  const result = await client.query<{
    enabled: boolean;
    consentAckVersion: string | null;
    acceptedAt: string | null;
  }>(
    `SELECT enabled, consent_ack_version AS "consentAckVersion",
            accepted_at::text AS "acceptedAt"
     FROM scout_voice_user_prefs WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  const row = result.rows[0];
  return {
    enabled: Boolean(row?.enabled),
    consentAckVersion: row?.consentAckVersion ?? null,
    acceptedAt: row?.acceptedAt ?? null,
  };
}

export async function computeScoutVoiceView(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    eventKey?: string | null;
    entryClientId?: string | null;
  },
): Promise<ScoutVoiceView> {
  const org = await resolveScoutOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to configure scouting voice notes.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
      canManageOrg: false,
      consent: SCOUT_VOICE_CONSENT_COPY,
      consentVersion: SCOUT_VOICE_CONSENT_VERSION,
      providers: { cloudConfigured: false, cloudProvider: null },
    };
  }

  const canManageOrg = org.role === "owner" || org.role === "admin";
  const [orgSettings, userPrefs, providers, notes] = await Promise.all([
    loadOrgSettings(client, org.orgId),
    loadUserPrefs(client, org.orgId, input.userId),
    detectCloudSttProvider(client, org.orgId, input.userId),
    loadNotes(client, org.orgId, {
      eventKey: input.eventKey,
      entryClientId: input.entryClientId,
    }),
  ]);

  const fullyEnabled = isScoutVoiceFullyEnabled({
    orgEnabled: orgSettings.enabled,
    orgAckVersion: orgSettings.consentAckVersion,
    userEnabled: userPrefs.enabled,
    userAckVersion: userPrefs.consentAckVersion,
  });

  if (!fullyEnabled) {
    return {
      status: "opt_in_required",
      message: !orgSettings.enabled
        ? "An owner or admin must enable voice notes for the team and accept the privacy consent."
        : "Enable voice notes for your account and accept the privacy consent before recording.",
      orgId: org.orgId,
      canManageOrg,
      orgSettings,
      userPrefs,
      consent: SCOUT_VOICE_CONSENT_COPY,
      consentVersion: SCOUT_VOICE_CONSENT_VERSION,
      providers,
      notes,
    };
  }

  if (!providers.cloudConfigured) {
    // Browser STT may still work client-side; surface a soft setup hint via providers.
    // Full setup_required only when the caller explicitly requests cloud STT (transcribe action).
  }

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    canManageOrg,
    orgSettings,
    userPrefs,
    consent: SCOUT_VOICE_CONSENT_COPY,
    consentVersion: SCOUT_VOICE_CONSENT_VERSION,
    providers,
    notes,
    computedAt: new Date().toISOString(),
  };
}

export async function setOrgVoiceOptIn(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    enabled: boolean;
    acceptConsent: boolean;
  },
): Promise<void> {
  if (input.enabled && !input.acceptConsent) {
    throw new Error("Privacy consent is required to enable org voice notes");
  }
  const ack = input.enabled ? SCOUT_VOICE_CONSENT_VERSION : null;
  await client.query(
    `INSERT INTO scout_voice_org_settings (
       org_id, enabled, consent_ack_version, accepted_at, accepted_by, updated_by
     ) VALUES ($1,$2,$3,CASE WHEN $2 THEN now() ELSE NULL END,CASE WHEN $2 THEN $4::uuid ELSE NULL END,$4)
     ON CONFLICT (org_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       consent_ack_version = EXCLUDED.consent_ack_version,
       accepted_at = EXCLUDED.accepted_at,
       accepted_by = EXCLUDED.accepted_by,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.enabled, ack, input.userId],
  );
}

export async function setUserVoiceOptIn(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    enabled: boolean;
    acceptConsent: boolean;
  },
): Promise<void> {
  if (input.enabled && !input.acceptConsent) {
    throw new Error("Privacy consent is required to enable personal voice notes");
  }
  const ack = input.enabled ? SCOUT_VOICE_CONSENT_VERSION : null;
  await client.query(
    `INSERT INTO scout_voice_user_prefs (
       org_id, user_id, enabled, consent_ack_version, accepted_at
     ) VALUES ($1,$2,$3,$4,CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (org_id, user_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       consent_ack_version = EXCLUDED.consent_ack_version,
       accepted_at = EXCLUDED.accepted_at,
       updated_at = now()`,
    [input.orgId, input.userId, input.enabled, ack],
  );
}

export async function attachVoiceNote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    matchKey: string | null;
    teamKey: string;
    entryType: "match" | "pit";
    entryClientId: string | null;
    entryId: string | null;
    mediaClientId: string | null;
    transcript: string;
    sttSource: ScoutVoiceSttSource;
  },
): Promise<string> {
  const orgSettings = await loadOrgSettings(client, input.orgId);
  const userPrefs = await loadUserPrefs(client, input.orgId, input.userId);
  if (
    !isScoutVoiceFullyEnabled({
      orgEnabled: orgSettings.enabled,
      orgAckVersion: orgSettings.consentAckVersion,
      userEnabled: userPrefs.enabled,
      userAckVersion: userPrefs.consentAckVersion,
    })
  ) {
    throw new Error("Voice notes require org and user opt-in with current privacy consent");
  }

  const transcript = input.transcript.trim();
  if (!transcript) throw new Error("transcript is required");

  const result = await client.query<{ id: string }>(
    `INSERT INTO scout_voice_notes (
       org_id, event_key, match_key, team_key, entry_type, entry_client_id, entry_id,
       media_client_id, transcript, stt_source, consent_ack_version, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      input.orgId,
      input.eventKey,
      input.matchKey,
      input.teamKey,
      input.entryType,
      input.entryClientId,
      input.entryId,
      input.mediaClientId,
      transcript.slice(0, 20_000),
      input.sttSource,
      SCOUT_VOICE_CONSENT_VERSION,
      input.userId,
    ],
  );
  return result.rows[0]!.id;
}

export async function deleteVoiceNote(
  client: PoolClient,
  input: { orgId: string; noteId: string },
): Promise<void> {
  await client.query(`DELETE FROM scout_voice_notes WHERE id = $1 AND org_id = $2`, [
    input.noteId,
    input.orgId,
  ]);
}

/**
 * Cloud STT path: meters AI usage. Throws a setup_required-style error when no provider is configured.
 * Browser STT must be used client-side and attached via attachVoiceNote without this helper.
 *
 * Endpoint resolution goes through the BYOK layer (resolveOrgSttEndpoint):
 * member/org OpenAI key → org OpenAI-compatible base URL (Ollama / LocalAI /
 * faster-whisper class servers) → platform OPENAI_API_KEY. When the configured
 * endpoint lacks /audio/transcriptions support the error says so honestly —
 * the transcript is never fabricated.
 */
export async function transcribeWithCloudStt(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    audioBase64: string;
    contentType: string;
    fileName?: string;
  },
): Promise<{
  transcript: string;
  costUsd: number;
  provider: string;
  model: string;
  source?: string;
  baseUrlOrigin?: string | null;
}> {
  const endpoint = await resolveOrgSttEndpoint(client, {
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!endpoint) {
    throw new Error(
      "setup_required: No speech-to-text provider is configured. Add an OpenAI key (team or personal) or an OpenAI-compatible base URL under Team → AI API keys, or use browser speech recognition.",
    );
  }

  const raw = Buffer.from(input.audioBase64, "base64");
  if (raw.byteLength < 64) throw new Error("Audio payload is too small");
  if (raw.byteLength > 25 * 1024 * 1024) throw new Error("Audio payload exceeds 25 MB");

  // Local endpoints have no provider bill — never fabricate a Whisper-rate cost for them.
  const estimatedCostUsd =
    endpoint.source === "local-connector"
      ? 0
      : estimateCloudSttCostUsd(raw.byteLength, input.contentType);
  const keySource =
    endpoint.source === "hosted"
      ? "platform"
      : endpoint.source === "local-connector"
        ? "local"
        : "byo";

  return meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: SCOUT_VOICE_STT_FEATURE,
    requestId: `scout-voice-stt-${randomUUID()}`,
    estimatedCostUsd,
    provider: endpoint.provider,
    model: endpoint.model,
    keySource,
    metadata: {
      contentType: input.contentType,
      byteSize: raw.byteLength,
      path: "cloud_stt",
      sttSource: endpoint.source,
      sttOrigin: endpoint.baseUrlOrigin,
    },
    invoke: async () => {
      const form = new FormData();
      const blob = new Blob([raw], { type: input.contentType || "audio/webm" });
      form.append("file", blob, input.fileName || "scout-voice.webm");
      form.append("model", endpoint.model);
      form.append("response_format", "json");

      const headers: Record<string, string> = {};
      // Ollama-class local servers accept requests without Authorization.
      if (endpoint.apiKey.trim()) headers.Authorization = `Bearer ${endpoint.apiKey}`;

      const response = await fetch(`${endpoint.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers,
        body: form,
      });
      if (isSttUnsupportedStatus(response.status)) {
        throw new Error(
          `setup_required: The configured AI endpoint${
            endpoint.baseUrlOrigin ? ` (${endpoint.baseUrlOrigin})` : ""
          } does not support audio transcription (/audio/transcriptions returned ${response.status}). Use browser speech recognition, or point Team → AI API keys at a Whisper-compatible server.`,
        );
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Cloud STT failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      const body = (await response.json()) as { text?: string };
      const transcript = typeof body.text === "string" ? body.text.trim() : "";
      if (!transcript) throw new Error("Cloud STT returned an empty transcript");

      return {
        value: {
          transcript,
          costUsd: estimatedCostUsd,
          provider: endpoint.provider,
          model: endpoint.model,
          source: endpoint.source,
          baseUrlOrigin: endpoint.baseUrlOrigin,
        },
        promptTokens: Math.max(1, Math.round(raw.byteLength / 1000)),
        completionTokens: Math.max(1, Math.round(transcript.length / 4)),
        costUsd: estimatedCostUsd,
        model: endpoint.model,
        provider: endpoint.provider,
      };
    },
  });
}
