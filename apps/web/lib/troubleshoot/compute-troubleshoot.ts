/**
 * Get-unstuck server logic: org resolution, grounding in the team's OWN history,
 * session persistence (the knowledge-transfer loop), and the optional AI triage.
 *
 * Grounding rule: every table read here is guarded with to_regclass and skipped
 * silently when absent, and every row shown is a real row the team wrote. Nothing
 * on this page is generated when the team has no data — the curated tree carries
 * the page on its own.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import {
  ChatProviderResolutionError,
  getOrgPromptCachingEnabled,
  resolveOrgChatAdapterWithProvenance,
  type ChatAdapter,
  type ResolvedModelProvenance,
} from "@vantage/agent";
import { createBridgeTransport } from "../ai-bridge/transport";
import { meteredAI } from "@vantage/billing";
import { buildTriagePrompt, clampDescription, parseTriageResponse, type TriageSuggestion } from "./ai-triage";
import {
  DOC_FRESHNESS_NOTE,
  listSymptoms,
  matchSymptoms,
  storedPath,
  symptomById,
  walkSymptom,
  type StoredPath,
  type TroubleshootAnswer,
  type TroubleshootSymptomSummary,
  type WalkResult,
} from "./symptom-tree";

const HISTORY_LIMIT = 4;
const RECENT_SESSION_LIMIT = 8;
const PRIOR_SESSION_LIMIT = 5;

export type TroubleshootSetupStep = { id: string; label: string; detail: string; href: string };

export type GroundedRow = {
  id: string;
  source: string;
  sourceLabel: string;
  title: string;
  detail: string;
  /** ISO date/time of the team's own record, or null when the row has none. */
  when: string | null;
  href: string;
};

export type Grounding = {
  rows: GroundedRow[];
  /** Sources whose tables are not present in this database. Shown, never faked. */
  unavailableSources: string[];
};

export type PriorSession = {
  id: string;
  symptomId: string;
  resolved: boolean;
  resolution: string | null;
  fixTitle: string | null;
  stepCount: number;
  createdAt: string;
  byName: string | null;
  mine: boolean;
};

export type TroubleshootView =
  | { status: "setup_required"; message: string; steps: TroubleshootSetupStep[]; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      symptoms: TroubleshootSymptomSummary[];
      recentSessions: PriorSession[];
      docNote: string;
      computedAt: string;
    };

export type TroubleshootSessionView = {
  sessionId: string | null;
  symptomId: string;
  walk: WalkResult;
  grounding: Grounding;
  priorSessions: PriorSession[];
  /** Present only when an AI adapter resolved AND returned a valid in-tree pick. */
  aiSuggestion: TriageSuggestion | null;
  /** Honest note when AI was asked for but unavailable — never a silent downgrade. */
  aiNote: string | null;
  /** What endpoint/model the triage call went to, when one resolved. */
  aiProvenance?: { provider: string; modelId: string; baseUrlOrigin: string | null; source: string } | null;
  /** Ranked offline matches, so the student can correct a wrong entry point. */
  alternatives: Array<{ symptomId: string; label: string }>;
};

const SETUP_STEPS: TroubleshootSetupStep[] = [
  {
    id: "workspace",
    label: "Select a workspace",
    detail: "Get-unstuck records what your team tried, so it needs to know which team you are on.",
    href: "/workspace",
  },
];

export function setupRequired(orgId: string | null = null): Extract<TroubleshootView, { status: "setup_required" }> {
  return {
    status: "setup_required",
    message: "Choose a workspace to use Get-unstuck with your team's history.",
    steps: SETUP_STEPS,
    orgId,
  };
}

export async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const result = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

/** Tables this feature reads opportunistically. Absent ones are skipped, never assumed. */
const OPTIONAL_TABLES = [
  "troubleshoot_sessions",
  "fmea_failures",
  "incident_reports",
  "pit_repair_triage_reports",
  "robot_failures",
  "code_deploy_log_entries",
  "robot_devices",
  "power_loads",
] as const;

type OptionalTable = (typeof OPTIONAL_TABLES)[number];

export async function presentTables(client: PoolClient): Promise<Set<OptionalTable>> {
  const result = await client.query<{ name: OptionalTable }>(
    `SELECT t.name FROM unnest($1::text[]) AS t(name)
     WHERE to_regclass('public.' || t.name) IS NOT NULL`,
    [[...OPTIONAL_TABLES]],
  );
  return new Set(result.rows.map((row) => row.name));
}

/** Symptom-specific structured sources, on top of the text-matched incident history. */
const STRUCTURED_SOURCES: Record<string, Array<"deploy-log" | "can-map" | "power-loads">> = {
  "deploy-fails": ["deploy-log"],
  "ds-no-code": ["deploy-log"],
  "can-device-not-found": ["can-map"],
  "motor-controller-blink-code": ["can-map"],
  brownout: ["power-loads"],
};

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function truncate(value: string | null | undefined, max = 240): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The team's own record of this symptom, newest first. Every row is something a
 * member typed; nothing here is inferred, scored, or generated.
 */
export async function loadGrounding(
  client: PoolClient,
  input: { orgId: string; symptomId: string },
): Promise<Grounding> {
  const symptom = symptomById(input.symptomId);
  if (!symptom) return { rows: [], unavailableSources: [] };

  const patterns = symptom.groundingTerms.map((term) => `%${term}%`);
  const present = await presentTables(client);
  const rows: GroundedRow[] = [];
  const unavailable: string[] = [];

  if (present.has("fmea_failures")) {
    const result = await client.query(
      `SELECT id::text AS id, title, subsystem_name AS "subsystem",
              COALESCE(NULLIF(btrim(fix), ''), NULLIF(btrim(root_cause), ''), failure_mode) AS detail,
              occurred_at AS "when", status
       FROM fmea_failures
       WHERE org_id = $1::uuid
         AND (title ILIKE ANY($2::text[])
              OR failure_mode ILIKE ANY($2::text[])
              OR COALESCE(root_cause, '') ILIKE ANY($2::text[])
              OR COALESCE(fix, '') ILIKE ANY($2::text[])
              OR subsystem_name ILIKE ANY($2::text[]))
       ORDER BY occurred_at DESC
       LIMIT $3::int`,
      [input.orgId, patterns, HISTORY_LIMIT],
    );
    for (const row of result.rows) {
      rows.push({
        id: `fmea:${row.id}`,
        source: "fmea",
        sourceLabel: "Your FMEA log",
        title: truncate(row.title, 120),
        detail: truncate(`${row.subsystem ? `${row.subsystem} · ` : ""}${row.detail ?? ""} (${row.status})`),
        when: isoOrNull(row.when),
        href: "/fmea",
      });
    }
  } else unavailable.push("FMEA log");

  if (present.has("robot_failures")) {
    const result = await client.query(
      `SELECT id::text AS id, subsystem, symptoms, COALESCE(resolution, cause) AS detail,
              occurred_at AS "when"
       FROM robot_failures
       WHERE org_id = $1::uuid
         AND (symptoms ILIKE ANY($2::text[])
              OR COALESCE(cause, '') ILIKE ANY($2::text[])
              OR COALESCE(resolution, '') ILIKE ANY($2::text[])
              OR subsystem ILIKE ANY($2::text[]))
       ORDER BY occurred_at DESC
       LIMIT $3::int`,
      [input.orgId, patterns, HISTORY_LIMIT],
    );
    for (const row of result.rows) {
      rows.push({
        id: `failure:${row.id}`,
        source: "robot-failure",
        sourceLabel: "Your failure log",
        title: truncate(`${row.subsystem}: ${row.symptoms}`, 120),
        detail: truncate(row.detail),
        when: isoOrNull(row.when),
        href: "/failure-patterns",
      });
    }
  } else unavailable.push("Failure log");

  if (present.has("pit_repair_triage_reports")) {
    const result = await client.query(
      `SELECT id::text AS id, title, subsystem_name AS "subsystem", symptom_note AS "detail",
              created_at AS "when"
       FROM pit_repair_triage_reports
       WHERE org_id = $1::uuid
         AND (title ILIKE ANY($2::text[])
              OR symptom_note ILIKE ANY($2::text[])
              OR subsystem_name ILIKE ANY($2::text[]))
       ORDER BY created_at DESC
       LIMIT $3::int`,
      [input.orgId, patterns, HISTORY_LIMIT],
    );
    for (const row of result.rows) {
      rows.push({
        id: `repair:${row.id}`,
        source: "repair",
        sourceLabel: "Your pit repair triage",
        title: truncate(row.title, 120),
        detail: truncate(`${row.subsystem ? `${row.subsystem} · ` : ""}${row.detail ?? ""}`),
        when: isoOrNull(row.when),
        href: "/pit-repair-triage",
      });
    }
  } else unavailable.push("Pit repair triage");

  if (present.has("incident_reports")) {
    const result = await client.query(
      `SELECT id::text AS id, title, COALESCE(corrective_action, description) AS detail,
              occurred_on AS "when", category
       FROM incident_reports
       WHERE org_id = $1::uuid
         AND (title ILIKE ANY($2::text[])
              OR COALESCE(description, '') ILIKE ANY($2::text[])
              OR COALESCE(corrective_action, '') ILIKE ANY($2::text[]))
       ORDER BY occurred_on DESC
       LIMIT $3::int`,
      [input.orgId, patterns, HISTORY_LIMIT],
    );
    for (const row of result.rows) {
      rows.push({
        id: `incident:${row.id}`,
        source: "incident",
        sourceLabel: "Your incident reports",
        title: truncate(row.title, 120),
        detail: truncate(`${row.category} · ${row.detail ?? ""}`),
        when: isoOrNull(row.when),
        href: "/safety",
      });
    }
  } else unavailable.push("Incident reports");

  const structured = STRUCTURED_SOURCES[input.symptomId] ?? [];

  if (structured.includes("deploy-log")) {
    if (present.has("code_deploy_log_entries")) {
      const result = await client.query(
        `SELECT id::text AS id, deployed_on AS "when", status, firmware_version AS "firmware",
                COALESCE(branch, '') AS branch, COALESCE(notes, '') AS notes
         FROM code_deploy_log_entries
         WHERE org_id = $1::uuid AND status IN ('failed', 'rolled_back')
         ORDER BY deployed_on DESC
         LIMIT $2::int`,
        [input.orgId, HISTORY_LIMIT],
      );
      for (const row of result.rows) {
        rows.push({
          id: `deploy:${row.id}`,
          source: "deploy-log",
          sourceLabel: "Your deploy log",
          title: truncate(`${row.status === "failed" ? "Failed deploy" : "Rolled back"} · ${row.firmware}`, 120),
          detail: truncate(`${row.branch ? `${row.branch} · ` : ""}${row.notes}`),
          when: isoOrNull(row.when),
          href: "/code-deploy-log",
        });
      }
    } else unavailable.push("Deploy log");
  }

  if (structured.includes("can-map")) {
    if (present.has("robot_devices")) {
      const result = await client.query(
        `SELECT id::text AS id, name, device_type AS "deviceType", can_id AS "canId",
                can_bus AS "canBus", subsystem
         FROM robot_devices
         WHERE org_id = $1::uuid AND can_id IS NOT NULL
         ORDER BY can_bus, can_id
         LIMIT 12`,
        [input.orgId],
      );
      for (const row of result.rows) {
        rows.push({
          id: `device:${row.id}`,
          source: "can-map",
          sourceLabel: "Your CAN-bus map",
          title: truncate(`ID ${row.canId} · ${row.name}`, 120),
          detail: truncate(`${row.deviceType} on ${row.canBus}${row.subsystem ? ` · ${row.subsystem}` : ""}`),
          when: null,
          href: "/wiring",
        });
      }
    } else unavailable.push("CAN-bus map");
  }

  if (structured.includes("power-loads")) {
    if (present.has("power_loads")) {
      const result = await client.query(
        `SELECT id::text AS id, name, subsystem, peak_amps AS "peakAmps", breaker_amps AS "breakerAmps"
         FROM power_loads
         WHERE org_id = $1::uuid AND peak_amps IS NOT NULL
         ORDER BY peak_amps DESC
         LIMIT 6`,
        [input.orgId],
      );
      for (const row of result.rows) {
        rows.push({
          id: `load:${row.id}`,
          source: "power-loads",
          sourceLabel: "Your power budget",
          title: truncate(`${row.name} · peak ${row.peakAmps} A`, 120),
          detail: truncate(
            `${row.subsystem || "unassigned"}${row.breakerAmps ? ` · ${row.breakerAmps} A breaker` : ""}`,
          ),
          when: null,
          href: "/power-budget",
        });
      }
    } else unavailable.push("Power budget");
  }

  return { rows, unavailableSources: unavailable };
}

function priorSessionFromRow(row: Record<string, unknown>, userId: string): PriorSession {
  const path = (row.path ?? {}) as Partial<StoredPath>;
  return {
    id: String(row.id),
    symptomId: String(row.symptom),
    resolved: Boolean(row.resolved),
    resolution: typeof row.resolution === "string" ? row.resolution : null,
    fixTitle: typeof path.fixTitle === "string" ? path.fixTitle : null,
    stepCount: Array.isArray(path.steps) ? path.steps.length : 0,
    createdAt: isoOrNull(row.createdAt) ?? "",
    byName: typeof row.byName === "string" ? row.byName : null,
    mine: row.userId === userId,
  };
}

/** Prior walks by ANYONE on the team for this symptom — resolved ones first. */
export async function loadPriorSessions(
  client: PoolClient,
  input: { orgId: string; userId: string; symptomId: string },
): Promise<PriorSession[]> {
  const present = await presentTables(client);
  if (!present.has("troubleshoot_sessions")) return [];
  const result = await client.query(
    `SELECT s.id::text AS id, s.symptom, s.path, s.resolved, s.resolution,
            s.created_at AS "createdAt", s.user_id::text AS "userId", u.name AS "byName"
     FROM troubleshoot_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.org_id = $1::uuid AND s.symptom = $2::text
     ORDER BY s.resolved DESC, s.created_at DESC
     LIMIT $3::int`,
    [input.orgId, input.symptomId, PRIOR_SESSION_LIMIT],
  );
  return result.rows.map((row) => priorSessionFromRow(row, input.userId));
}

async function loadRecentSessions(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<PriorSession[]> {
  const present = await presentTables(client);
  if (!present.has("troubleshoot_sessions")) return [];
  const result = await client.query(
    `SELECT s.id::text AS id, s.symptom, s.path, s.resolved, s.resolution,
            s.created_at AS "createdAt", s.user_id::text AS "userId", u.name AS "byName"
     FROM troubleshoot_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.org_id = $1::uuid
     ORDER BY s.created_at DESC
     LIMIT $2::int`,
    [input.orgId, RECENT_SESSION_LIMIT],
  );
  return result.rows.map((row) => priorSessionFromRow(row, input.userId));
}

export async function computeTroubleshootView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<TroubleshootView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequired(input.requestedOrg);

  const recentSessions = await loadRecentSessions(client, { orgId: org.orgId, userId: input.userId });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    symptoms: listSymptoms(),
    recentSessions,
    docNote: DOC_FRESHNESS_NOTE,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Optional AI triage
// ---------------------------------------------------------------------------

/**
 * Ask the org's own model to pick an entry node. Returns null — and the caller
 * falls back to the offline matcher — when no adapter resolves, when the call
 * fails, or when the response names anything outside the tree.
 */
export async function triageWithAi(
  client: PoolClient,
  input: { orgId: string; userId: string; description: string },
): Promise<{
  suggestion: TriageSuggestion | null;
  note: string | null;
  provenance: ResolvedModelProvenance | null;
}> {
  const description = clampDescription(input.description);
  if (!description) return { suggestion: null, note: null, provenance: null };

  const promptCachingEnabled = await getOrgPromptCachingEnabled(client, input.orgId).catch(() => true);

  let adapter: ChatAdapter;
  let provenance: ResolvedModelProvenance;
  try {
    ({ adapter, provenance } = await resolveOrgChatAdapterWithProvenance(client, {
      orgId: input.orgId,
      userId: input.userId,
      promptCachingEnabled,
      feature: "chat",
      bridgeTransport: createBridgeTransport(),
    }));
  } catch (error) {
    if (error instanceof ChatProviderResolutionError) {
      return {
        suggestion: null,
        note: "No AI provider is configured, so the symptom was matched from your words offline. The walk below is identical either way.",
        provenance: null,
      };
    }
    throw error;
  }

  const prompt = buildTriagePrompt(description);

  try {
    const text = await meteredAI({
      client,
      orgId: input.orgId,
      userId: input.userId,
      feature: "troubleshoot",
      requestId: `troubleshoot-${randomUUID()}`,
      estimatedCostUsd: 0,
      estimatedPromptTokens: Math.ceil(prompt.length / 4),
      estimatedCompletionTokens: 120,
      provider: adapter.provider,
      model: adapter.model,
      metadata: { path: "troubleshoot_triage" },
      invoke: async () => {
        const response = await adapter.complete({ message: prompt, context: [], promptCachingEnabled });
        return {
          value: response.text,
          promptTokens: response.promptTokens,
          completionTokens: response.completionTokens,
          costUsd: response.costUsd,
          model: adapter.model,
          provider: adapter.provider,
          cacheReadInputTokens: response.cacheReadInputTokens,
          cacheWriteInputTokens: response.cacheWriteInputTokens,
          uncachedInputTokens: response.uncachedInputTokens,
        };
      },
    });

    const suggestion = parseTriageResponse(text);
    if (!suggestion) {
      return {
        suggestion: null,
        note: "The model did not name a symptom in the curated tree, so the offline match was used instead.",
        provenance,
      };
    }
    return { suggestion, note: null, provenance };
  } catch {
    return {
      suggestion: null,
      note: "The AI triage call did not complete, so the symptom was matched from your words offline.",
      provenance,
    };
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function startSession(
  client: PoolClient,
  input: { orgId: string; userId: string; symptomId: string; described: string | null },
): Promise<string | null> {
  const present = await presentTables(client);
  if (!present.has("troubleshoot_sessions")) return null;
  const walk = walkSymptom(input.symptomId, []);
  if (!walk) return null;
  const result = await client.query<{ id: string }>(
    `INSERT INTO troubleshoot_sessions (org_id, user_id, symptom, described, path)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb)
     RETURNING id::text AS id`,
    [input.orgId, input.userId, input.symptomId, input.described, JSON.stringify(storedPath(walk))],
  );
  return result.rows[0]?.id ?? null;
}

export async function saveWalk(
  client: PoolClient,
  input: { orgId: string; userId: string; sessionId: string; walk: WalkResult },
): Promise<void> {
  const present = await presentTables(client);
  if (!present.has("troubleshoot_sessions")) return;
  await client.query(
    `UPDATE troubleshoot_sessions
     SET path = $1::jsonb, updated_at = now()
     WHERE id = $2::uuid AND org_id = $3::uuid AND user_id = $4::uuid`,
    [JSON.stringify(storedPath(input.walk)), input.sessionId, input.orgId, input.userId],
  );
}

export async function closeSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sessionId: string;
    resolved: boolean;
    resolution: string | null;
  },
): Promise<void> {
  const present = await presentTables(client);
  if (!present.has("troubleshoot_sessions")) return;
  await client.query(
    `UPDATE troubleshoot_sessions
     SET resolved = $1::boolean, resolution = $2::text, updated_at = now()
     WHERE id = $3::uuid AND org_id = $4::uuid AND user_id = $5::uuid`,
    [input.resolved, input.resolution, input.sessionId, input.orgId, input.userId],
  );
}

/** Everything the walk screen needs, grounded in the team's own rows. */
export async function computeSessionView(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    symptomId: string;
    sessionId: string | null;
    answers: TroubleshootAnswer[];
    aiSuggestion?: TriageSuggestion | null;
    aiNote?: string | null;
    aiProvenance?: ResolvedModelProvenance | null;
    alternatives?: Array<{ symptomId: string; label: string }>;
  },
): Promise<TroubleshootSessionView | null> {
  const walk = walkSymptom(input.symptomId, input.answers);
  if (!walk) return null;

  const [grounding, priorSessions] = await Promise.all([
    loadGrounding(client, { orgId: input.orgId, symptomId: input.symptomId }),
    loadPriorSessions(client, { orgId: input.orgId, userId: input.userId, symptomId: input.symptomId }),
  ]);

  return {
    sessionId: input.sessionId,
    symptomId: input.symptomId,
    walk,
    grounding,
    priorSessions,
    aiSuggestion: input.aiSuggestion ?? null,
    aiNote: input.aiNote ?? null,
    aiProvenance: input.aiProvenance ?? null,
    alternatives:
      input.alternatives ??
      matchSymptoms(symptomById(input.symptomId)?.label ?? "", 3).map((hit) => ({
        symptomId: hit.symptomId,
        label: hit.label,
      })),
  };
}
