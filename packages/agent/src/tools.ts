import { AIToolRegistry, type ToolDefinition } from "./orchestrator";
import { checkGameRuleCompliance } from "./rule-compliance";
import { FINANCE_IN_AI_DENIED, sanitizeFinancePayloadForAi } from "./finance-redact";
import { isFinanceInAiAllowed, loadOrgAiPolicy } from "@vantage/billing";
import { resolveActiveSeasonYear } from "./season-year";

const object = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool input must be an object");
  return value as Record<string, unknown>;
};
const teamInput = (value: unknown) => {
  const input = object(value);
  const teamKey = String(input.teamKey ?? "");
  if (!/^frc\d+$/.test(teamKey)) throw new Error("teamKey must be a valid team key");
  return { teamKey };
};
const matchInput = (value: unknown) => {
  const input = object(value);
  const matchKey = String(input.matchKey ?? "").trim();
  if (!matchKey) throw new Error("matchKey is required");
  return { matchKey };
};
const seasonInput = (value: unknown) => {
  const input = object(value);
  const raw = input.seasonYear;
  if (raw == null || raw === "") {
    // Caller / execute will lock to org active season via activeEventKey.
    return { seasonYear: undefined as number | undefined };
  }
  const seasonYear = Number(raw);
  if (!Number.isInteger(seasonYear) || seasonYear < 1992 || seasonYear > 2100) {
    throw new Error("seasonYear must be a whole number between 1992 and 2100");
  }
  return { seasonYear };
};

function lockSeasonYear(seasonYear: number | undefined, activeEventKey: string | null, matchKey?: string | null) {
  return resolveActiveSeasonYear({ seasonYear, activeEventKey, matchKey });
}
const rowsOutput = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error("Tool output must be an array");
  return value as Array<Record<string, unknown>>;
};
const objectOutput = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool output must be an object");
  }
  return value as Record<string, unknown>;
};

function tool<I, O>(value: ToolDefinition<I, O>) {
  return value;
}

/** Tools shared by Assistant, Strategy, and CAD — one authorization graph. */
export const SHARED_STRATEGY_CAD_TOOLS = [
  "kickoff.intelligence",
  "kickoff.rules",
  "rules.compliance",
  "strategy.design",
  "strategy.match",
  "strategy.private_edge",
  "scouting.team",
  "scouting.schema",
  "reference.team",
  "fmea.open_risks",
  "fmea.repeat",
  "cad.briefs",
  "cad.design_context",
  "cad.create_brief",
  "cad.vault",
  "inventory.availability",
  "knowledge.search",
  "knowledge.get_page",
  "finance.summary",
  "finance.orders",
  "finance.create_purchase_request",
  "my_day.summary",
] as const;

export { ORG_DATA_TOOL_NAMES as ORG_DATA_TOOLS } from "./feature-context";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function usdLabel(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Rule-based open-order blurb — only returned when Finance-in-AI is allowed. */
export function summarizeOpenPurchaseRequests(
  orders: Array<{
    title: string;
    status: string;
    totalCostUsd: number;
    itemUrl: string | null;
    buyerUserId: string | null;
  }>,
) {
  const open = orders.filter((o) => o.status === "pending" || o.status === "approved");
  const pending = open.filter((o) => o.status === "pending");
  const approved = open.filter((o) => o.status === "approved");
  const openTotalUsd = round2(open.reduce((sum, o) => sum + o.totalCostUsd, 0));
  const recommendations: string[] = [];
  if (!open.length) {
    return {
      headline: "No open purchase requests — nothing waiting on approval or ordering.",
      recommendations: ["When someone submits a need, it will show up for admin review."],
      openCount: 0,
      openTotalUsd: 0,
    };
  }
  let headline: string;
  if (pending.length && approved.length) {
    headline = `${pending.length} awaiting approval and ${approved.length} ready to buy (${usdLabel(openTotalUsd)} open).`;
  } else if (pending.length) {
    headline = `${pending.length} request${pending.length === 1 ? "" : "s"} awaiting admin approval (${usdLabel(openTotalUsd)}).`;
  } else {
    headline = `${approved.length} approved request${approved.length === 1 ? "" : "s"} ready to order (${usdLabel(openTotalUsd)}).`;
  }
  if (pending.length) {
    const largest = [...pending].sort((a, b) => b.totalCostUsd - a.totalCostUsd)[0]!;
    recommendations.push(
      `Review “${largest.title}” first (${usdLabel(largest.totalCostUsd)}) — largest pending estimate.`,
    );
  }
  const missingLink = approved.filter((o) => !o.itemUrl);
  if (missingLink.length) {
    recommendations.push(
      `${missingLink.length} approved request${missingLink.length === 1 ? "" : "s"} missing a vendor link — add a product URL before ordering.`,
    );
  }
  const unassigned = approved.filter((o) => !o.buyerUserId);
  if (unassigned.length) {
    recommendations.push(
      `Assign a buyer on ${unassigned.length} approved request${unassigned.length === 1 ? "" : "s"}.`,
    );
  }
  if (!recommendations.length) {
    recommendations.push("Open requests look complete — approve pending items or mark buys as ordered.");
  }
  return { headline, recommendations, openCount: open.length, openTotalUsd };
}

export function createVantageToolRegistry(): AIToolRegistry {
  return new AIToolRegistry()
    .register(
      tool({
        name: "web.search",
        description:
          "Search the public web via configured search API (Brave or RESEARCH_SEARCH_*). Soft-degrades to setup_required when no key is configured — never invents search hits.",
        parseInput: (value) => {
          const input = object(value);
          const query = String(input.query ?? "").trim();
          if (!query) throw new Error("query is required");
          return {
            query: query.slice(0, 500),
            limit: input.limit != null ? Number(input.limit) : 5,
          };
        },
        parseOutput: objectOutput,
        async execute(_context, input) {
          const { executeWebSearch } = await import("./web-tools");
          return executeWebSearch(input);
        },
      }),
    )
    .register(
      tool({
        name: "web.fetch",
        description:
          "HTTPS GET an allowlisted public FRC docs URL (FIRST, official match results, season ratings, WPILib docs). SSRF-guarded; returns truncated text excerpt only. Soft-degrades when browse is disabled.",
        parseInput: (value) => {
          const input = object(value);
          const url = String(input.url ?? "").trim();
          if (!url) throw new Error("url is required");
          return { url: url.slice(0, 2000) };
        },
        parseOutput: objectOutput,
        async execute(_context, input) {
          const { executeWebFetch } = await import("./web-tools");
          return executeWebFetch(input);
        },
      }),
    )
    .register(
      tool({
        name: "reference.team",
        description: "Read platform-global team and event metrics",
        parseInput: teamInput,
        parseOutput: rowsOutput,
        async execute({ client, activeEventKey }, input) {
          return (
            await client.query(
              `SELECT t.team_key AS "teamKey",t.team_number AS "teamNumber",t.nickname,e.epa,e.auto_epa AS "autoEpa",e.teleop_epa AS "teleopEpa",e.endgame_epa AS "endgameEpa"
               FROM teams_ref t
               LEFT JOIN team_event_metrics e ON e.team_key=t.team_key AND e.event_key=$2
               WHERE t.team_key=$1`,
              [input.teamKey, activeEventKey],
            )
          ).rows;
        },
      }),
    )
    .register(
      tool({
        name: "scouting.team",
        description:
          "Read organization-scoped match + pit scouting with official-result trust and custom form field labels. Contradicted climb/mobility/foul fields are stripped from trustedPayload — never treat them as facts. Prefer trustedLabeled over raw keys when summarizing custom schemas.",
        parseInput: teamInput,
        parseOutput: rowsOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const entries = (
            await client.query<{
              id: string;
              entryType: string;
              teamKey: string;
              matchKey: string | null;
              schemaId: string | null;
              payload: Record<string, unknown>;
              confidence: string | null;
              scoutUserId: string | null;
              updatedAt: string;
            }>(
              `SELECT * FROM (
                 SELECT id, 'match' AS "entryType", team_key AS "teamKey", match_key AS "matchKey",
                        schema_id::text AS "schemaId",
                        payload, confidence, scout_user_id::text AS "scoutUserId",
                        updated_at AS "updatedAt"
                 FROM match_scout_entries
                 WHERE org_id=$1 AND event_key=$2 AND team_key=$3
                 UNION ALL
                 SELECT id, 'pit' AS "entryType", team_key AS "teamKey", NULL::text AS "matchKey",
                        schema_id::text AS "schemaId",
                        payload, confidence, scout_user_id::text AS "scoutUserId",
                        updated_at AS "updatedAt"
                 FROM pit_scout_entries
                 WHERE org_id=$1 AND event_key=$2 AND team_key=$3
               ) entries
               ORDER BY "updatedAt" DESC
               LIMIT 40`,
              [orgId, activeEventKey, input.teamKey],
            )
          ).rows;
          const schemaIds = [...new Set(entries.map((row) => row.schemaId).filter(Boolean))] as string[];
          const schemaFields = new Map<string, Array<{ key: string; label: string; type: string }>>();
          if (schemaIds.length) {
            try {
              const schemas = await client.query<{
                id: string;
                definition: { fields?: Array<{ key?: string; label?: string; type?: string }> };
              }>(
                `SELECT id, schema AS definition FROM scout_schemas
                 WHERE org_id=$1 AND id = ANY($2::uuid[])`,
                [orgId, schemaIds],
              );
              for (const schema of schemas.rows) {
                const fields = Array.isArray(schema.definition?.fields)
                  ? schema.definition.fields
                      .map((field) => ({
                        key: String(field.key ?? "").trim(),
                        label: String(field.label ?? field.key ?? "").trim(),
                        type: String(field.type ?? "text"),
                      }))
                      .filter((field) => field.key)
                  : [];
                schemaFields.set(schema.id, fields);
              }
            } catch {
              // Schema table / column may be missing — degrade without labels.
            }
          }
          // Latest published match/pit schemas (form builder) so empty teams still expose field catalog.
          let publishedCatalog: Array<{
            type: string;
            schemaId: string;
            title: string;
            fields: Array<{ key: string; label: string; type: string }>;
          }> = [];
          try {
            const published = await client.query<{
              id: string;
              type: string;
              title: string;
              fields: Array<{ key?: string; label?: string; type?: string }>;
            }>(
              `SELECT DISTINCT ON (type)
                 id, type, COALESCE(schema->>'title', type) AS title,
                 COALESCE(schema->'fields', '[]'::jsonb) AS fields
               FROM scout_schemas
               WHERE org_id=$1
               ORDER BY type, version DESC`,
              [orgId],
            );
            publishedCatalog = published.rows.map((row) => ({
              type: row.type,
              schemaId: row.id,
              title: row.title,
              fields: (Array.isArray(row.fields) ? row.fields : [])
                .map((field) => ({
                  key: String(field.key ?? "").trim(),
                  label: String(field.label ?? field.key ?? "").trim(),
                  type: String(field.type ?? "text"),
                }))
                .filter((field) => field.key),
            }));
          } catch {
            publishedCatalog = [];
          }
          const matchIds = entries.filter((row) => row.entryType === "match").map((row) => row.id);
          const validations = matchIds.length
            ? (
                await client.query<{
                  entryId: string;
                  fieldKey: string;
                  status: "match" | "conflict" | "unavailable" | "not_comparable";
                  scoutValue: unknown;
                  officialValue: unknown;
                  officialSource: string;
                  detail: string;
                }>(
                  `SELECT entry_id AS "entryId", field_key AS "fieldKey", status,
                          scout_value AS "scoutValue", official_value AS "officialValue",
                          official_source AS "officialSource", detail
                   FROM scout_entry_validations
                   WHERE org_id=$1 AND entry_id = ANY($2::uuid[])
                   ORDER BY checked_at DESC`,
                  [orgId, matchIds],
                )
              ).rows
            : [];
          const byEntry = new Map<string, typeof validations>();
          for (const row of validations) {
            const list = byEntry.get(row.entryId) ?? [];
            list.push(row);
            byEntry.set(row.entryId, list);
          }
          return entries.map((entry) => {
            const entryValidations = byEntry.get(entry.id) ?? [];
            const conflictKeys = new Set(
              entryValidations.filter((row) => row.status === "conflict").map((row) => row.fieldKey),
            );
            const catalog =
              (entry.schemaId ? schemaFields.get(entry.schemaId) : null) ??
              publishedCatalog.find((row) => row.type === entry.entryType)?.fields ??
              [];
            const labelByKey = new Map(catalog.map((field) => [field.key, field.label || field.key]));
            const trustedPayload: Record<string, unknown> = {};
            const trustedLabeled: Array<{ key: string; label: string; value: unknown }> = [];
            const excludedFields: string[] = [];
            for (const [key, value] of Object.entries(entry.payload ?? {})) {
              if (conflictKeys.has(key)) {
                excludedFields.push(key);
                continue;
              }
              trustedPayload[key] = value;
              trustedLabeled.push({
                key,
                label: labelByKey.get(key) ?? key,
                value,
              });
            }
            return {
              id: entry.id,
              entryType: entry.entryType,
              teamKey: entry.teamKey,
              matchKey: entry.matchKey,
              schemaId: entry.schemaId,
              fieldCatalog: catalog,
              /** Raw scout payload — may include official-result-contradicted fields; prefer trustedPayload. */
              payload: entry.payload,
              trustedPayload,
              trustedLabeled,
              excludedFields: excludedFields.sort(),
              tbaValidations: entryValidations.map((row) => ({
                fieldKey: row.fieldKey,
                status: row.status,
                scoutValue: row.scoutValue,
                officialValue: row.officialValue,
                officialSource: row.officialSource,
                detail: row.detail,
              })),
              conflictCount: conflictKeys.size,
              confidence: entry.confidence,
              scoutUserId: entry.scoutUserId,
              updatedAt: entry.updatedAt,
              publishedSchemas: publishedCatalog,
            };
          });
        },
      }),
    )
    .register(
      tool({
        name: "scouting.schema",
        description:
          "Read this org's latest published match/pit custom form schemas (form builder field keys, labels, types including drivetrain/robot_image). Empty when no forms are published — never invent DEMO fields.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query<{
              id: string;
              year: number;
              type: string;
              version: number;
              title: string;
              fields: Array<{ key?: string; label?: string; type?: string; options?: string[] }>;
            }>(
              `SELECT DISTINCT ON (type)
                 id, year, type, version,
                 COALESCE(schema->>'title', type) AS title,
                 COALESCE(schema->'fields', '[]'::jsonb) AS fields
               FROM scout_schemas
               WHERE org_id=$1 AND ($2::int IS NULL OR year=$2)
               ORDER BY type, version DESC`,
              [orgId, seasonYear],
            );
            if (!rows.rows.length) {
              return {
                seasonYear,
                schemas: [],
                emptyReason: "No published scouting forms yet — open Form builder to create match/pit schemas.",
              };
            }
            return {
              seasonYear,
              schemas: rows.rows.map((row) => ({
                schemaId: row.id,
                year: row.year,
                type: row.type,
                version: row.version,
                title: row.title,
                fields: (Array.isArray(row.fields) ? row.fields : [])
                  .map((field) => ({
                    key: String(field.key ?? "").trim(),
                    label: String(field.label ?? field.key ?? "").trim(),
                    type: String(field.type ?? "text"),
                    options: Array.isArray(field.options)
                      ? field.options.map((option) => String(option)).filter(Boolean)
                      : undefined,
                  }))
                  .filter((field) => field.key),
              })),
            };
          } catch {
            return {
              seasonYear,
              schemas: [],
              setup_required: true,
              emptyReason: "Scouting form schemas are not available yet.",
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "strategy.match",
        description:
          "Read stored match prediction + strategy plan, scout provenance, and official-result scout conflicts for alliance teams",
        parseInput: matchInput,
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          const prediction = await client.query(
            `SELECT id, match_key AS "matchKey", model_version AS "modelVersion",
                    p_red AS "pRed", p_blue AS "pBlue",
                    confidence_low AS "confidenceLow", confidence_high AS "confidenceHigh",
                    effective_sample_size AS "effectiveSampleSize",
                    key_factors AS "keyFactors", features, caveats, scored_at AS "scoredAt"
             FROM predictions
             WHERE org_id=$1 AND match_key=$2
             ORDER BY scored_at DESC
             LIMIT 1`,
            [orgId, input.matchKey],
          );
          const plan = await client.query(
            `SELECT alliance, plan, created_at AS "createdAt"
             FROM match_strategies
             WHERE org_id=$1 AND match_key=$2
             ORDER BY created_at DESC
             LIMIT 1`,
            [orgId, input.matchKey],
          );
          const match = await client.query<{
            redAlliance: { teamKeys?: string[] };
            blueAlliance: { teamKeys?: string[] };
            eventKey: string;
          }>(
            `SELECT red_alliance AS "redAlliance", blue_alliance AS "blueAlliance", event_key AS "eventKey"
             FROM matches_ref WHERE match_key=$1`,
            [input.matchKey],
          );
          const teamKeys = [
            ...(match.rows[0]?.redAlliance?.teamKeys ?? []),
            ...(match.rows[0]?.blueAlliance?.teamKeys ?? []),
          ];
          const scoutConflicts =
            teamKeys.length && match.rows[0]?.eventKey
              ? (
                  await client.query(
                    `SELECT e.team_key AS "teamKey", e.id AS "entryId", e.match_key AS "matchKey",
                            v.field_key AS "fieldKey", v.status, v.scout_value AS "scoutValue",
                            v.official_value AS "officialValue", v.official_source AS "officialSource",
                            v.detail
                     FROM scout_entry_validations v
                     JOIN match_scout_entries e ON e.id = v.entry_id
                     WHERE v.org_id=$1 AND e.event_key=$2 AND e.team_key = ANY($3::text[])
                       AND v.status='conflict'
                     ORDER BY v.checked_at DESC
                     LIMIT 40`,
                    [orgId, match.rows[0].eventKey, teamKeys],
                  )
                ).rows
              : [];
          return {
            prediction: prediction.rows[0] ?? null,
            strategy: plan.rows[0] ?? null,
            scoutTbaConflicts: scoutConflicts,
            trustNote:
              scoutConflicts.length > 0
                ? "Scout fields listed below contradicted official match results — do not trust those values."
                : "No official-result scout conflicts recorded for alliance teams.",
          };
        },
      }),
    )
    .register(
      tool({
        name: "strategy.private_edge",
        description:
          "Read org-private season ratings, scout-field calibration vs official results, opponent scout profiles, and scout-to-pit signals for the active event. Empty when no org scouts — never invents public season-rating clones.",
        parseInput: (value) => {
          const input = object(value);
          return {
            eventKey: String(input.eventKey ?? "").trim() || undefined,
            matchKey: String(input.matchKey ?? "").trim() || undefined,
          };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const eventKey = input.eventKey || activeEventKey;
          if (!eventKey) {
            return {
              status: "setup_required",
              message: "Set an active event to read your team's scouting ratings.",
              teams: [],
            };
          }
          try {
            const snapshots = await client.query(
              `SELECT team_key AS "teamKey", public_epa::float AS "publicEpa", pepa::float AS pepa,
                      scout_component_epa::float AS "scoutComponentEpa", scout_sample::float AS "scoutSample",
                      components, computed_at::text AS "computedAt"
               FROM private_epa_snapshots
               WHERE org_id = $1 AND event_key = $2
               ORDER BY pepa DESC
               LIMIT 40`,
              [orgId, eventKey],
            );
            const calibrations = await client.query(
              `SELECT field_key AS "fieldKey", scout_user_id::text AS "scoutUserId",
                      agreement_rate::float AS "agreementRate", n_samples AS "nSamples"
               FROM scout_field_reliability
               WHERE org_id = $1 AND event_key = $2
               ORDER BY n_samples DESC
               LIMIT 20`,
              [orgId, eventKey],
            );
            const pit = await client.query(
              `SELECT team_key AS "teamKey", match_key AS "matchKey", signal_kind AS "signalKind",
                      note, alliance_color AS "alliance", created_at::text AS "createdAt"
               FROM scout_pit_signals
               WHERE org_id = $1 AND event_key = $2
               ORDER BY created_at DESC
               LIMIT 20`,
              [orgId, eventKey],
            );
            return {
              status: snapshots.rows.length ? "live" : "empty",
              eventKey,
              matchKey: input.matchKey ?? null,
              teams: snapshots.rows,
              calibrations: calibrations.rows,
              pitSignals: pit.rows,
              emptyReason: snapshots.rows.length
                ? null
                : "No scouting ratings yet. Scout at least 3 matches, then open Strategy.",
            };
          } catch {
            return {
              status: "setup_required",
              message: "Scouting ratings are not available yet. Ask an owner to finish setup.",
              eventKey,
              teams: [],
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "research.findings",
        description: "Read source-cited platform-global research findings",
        parseInput: teamInput,
        parseOutput: rowsOutput,
        async execute({ client }, input) {
          return (
            await client.query(
              `SELECT id,summary,confidence,source_url AS "sourceUrl",published_at AS "publishedAt",found_at AS "foundAt",extracted_facts AS "facts"
               FROM research_findings WHERE team_key=$1 ORDER BY found_at DESC LIMIT 20`,
              [input.teamKey],
            )
          ).rows;
        },
      }),
    )
    .register(
      tool({
        name: "artifacts.related",
        description: "Read prior generated artifacts in this organization",
        parseInput(value) {
          const input = object(value);
          return { kind: String(input.kind ?? "") };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          return (
            await client.query(
              `SELECT id,kind,title,version,content,claim_provenance AS "claimProvenance",created_at AS "createdAt"
               FROM ai_artifacts WHERE org_id=$1 AND ($2='' OR kind=$2) ORDER BY created_at DESC LIMIT 20`,
              [orgId, input.kind],
            )
          ).rows;
        },
      }),
    )
    .register(
      tool({
        name: "knowledge.search",
        description:
          "Search the team wiki, decision records, and design reviews (cross-season institutional knowledge). Returns empty when nothing matches — never invents history.",
        parseInput(value) {
          const input = object(value);
          const query = String(input.query ?? "").trim();
          if (!query) throw new Error("query is required");
          const limit = Math.min(Math.max(Number(input.limit ?? 8) || 8, 1), 20);
          return { query: query.slice(0, 200), limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          const hits: Array<Record<string, unknown>> = [];
          try {
            const wiki = await client.query(
              `SELECT 'wiki' AS source, id::text AS id, title, slug,
                      left(coalesce(body,''), 240) AS snippet,
                      season_year AS "seasonYear"
               FROM knowledge_pages
               WHERE org_id=$1::uuid
                 AND (
                   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
                     @@ plainto_tsquery('english', $2)
                   OR title ILIKE '%' || $2 || '%'
                   OR body ILIKE '%' || $2 || '%'
                 )
               ORDER BY updated_at DESC LIMIT $3`,
              [orgId, input.query, input.limit],
            );
            hits.push(...wiki.rows);
          } catch {
            // knowledge_pages not migrated yet
          }
          try {
            const decisions = await client.query(
              `SELECT 'decision' AS source, id::text AS id, title, NULL::text AS slug,
                      left(coalesce(decision, rationale, context, ''), 240) AS snippet,
                      season_year AS "seasonYear"
               FROM decision_records
               WHERE org_id=$1::uuid
                 AND (
                   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(context,'') || ' ' ||
                     coalesce(decision,'') || ' ' || coalesce(rationale,'') || ' ' || coalesce(notes,''))
                     @@ plainto_tsquery('english', $2)
                   OR title ILIKE '%' || $2 || '%'
                   OR coalesce(decision,'') ILIKE '%' || $2 || '%'
                   OR coalesce(rationale,'') ILIKE '%' || $2 || '%'
                 )
               ORDER BY season_year DESC, created_at DESC LIMIT $3`,
              [orgId, input.query, input.limit],
            );
            hits.push(...decisions.rows);
          } catch {
            // decision_records unavailable
          }
          try {
            const reviews = await client.query(
              `SELECT 'design_review' AS source, id::text AS id, title, NULL::text AS slug,
                      left(coalesce(notes, subsystem, ''), 240) AS snippet,
                      season_year AS "seasonYear"
               FROM design_reviews
               WHERE org_id=$1::uuid
                 AND (
                   to_tsvector('english', coalesce(title,'') || ' ' || coalesce(subsystem,'') || ' ' || coalesce(notes,''))
                     @@ plainto_tsquery('english', $2)
                   OR title ILIKE '%' || $2 || '%'
                   OR subsystem ILIKE '%' || $2 || '%'
                   OR coalesce(notes,'') ILIKE '%' || $2 || '%'
                 )
               ORDER BY season_year DESC, updated_at DESC LIMIT $3`,
              [orgId, input.query, input.limit],
            );
            hits.push(...reviews.rows);
          } catch {
            // design_reviews unavailable
          }
          return hits.slice(0, input.limit);
        },
      }),
    )
    .register(
      tool({
        name: "knowledge.get_page",
        description: "Load one team wiki page by slug or id, including linked decisions and design reviews",
        parseInput(value) {
          const input = object(value);
          const slug = String(input.slug ?? "").trim();
          const id = String(input.id ?? "").trim();
          if (!slug && !id) throw new Error("slug or id is required");
          return { slug: slug || null, id: id || null };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          try {
            const page = await client.query(
              `SELECT id, slug, title, body, template_kind AS "templateKind",
                      season_year AS "seasonYear", tags, pinned, updated_at AS "updatedAt"
               FROM knowledge_pages
               WHERE org_id=$1::uuid
                 AND ($2::uuid IS NULL OR id=$2::uuid)
                 AND ($3::text IS NULL OR slug=$3::text)
               LIMIT 1`,
              [orgId, input.id, input.slug],
            );
            const row = page.rows[0];
            if (!row) return { page: null, links: [] };
            const links = await client.query(
              `SELECT l.target_type AS "targetType", l.target_id::text AS "targetId", l.note,
                      coalesce(d.title, r.title) AS "targetTitle",
                      coalesce(d.season_year, r.season_year) AS "seasonYear"
               FROM knowledge_links l
               LEFT JOIN decision_records d ON l.target_type='decision' AND d.id=l.target_id AND d.org_id=l.org_id
               LEFT JOIN design_reviews r ON l.target_type='design_review' AND r.id=l.target_id AND r.org_id=l.org_id
               WHERE l.org_id=$1::uuid AND l.page_id=$2::uuid
               ORDER BY l.created_at DESC LIMIT 30`,
              [orgId, row.id],
            );
            return { page: row, links: links.rows };
          } catch {
            return { page: null, links: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "kickoff.intelligence",
        description:
          "Read the latest kickoff game-release intelligence summary (manual/transcript → structured game + design directions)",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const row = await client.query(
              `SELECT id, season_year AS "seasonYear", status, title, summary,
                      strategy_advice AS "strategyAdvice",
                      design_priorities_draft AS "designPrioritiesDraft",
                      cad_brief_request AS "cadBriefRequest",
                      cad_job_id AS "cadJobId", advice_label AS "adviceLabel",
                      created_at AS "createdAt", applied_at AS "appliedAt"
               FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 1`,
              [orgId, seasonYear],
            );
            return { seasonYear, record: row.rows[0] ?? null };
          } catch {
            return { seasonYear, record: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "kickoff.rules",
        description:
          "Read kickoff rule notes plus constraints from game intelligence for rules Q&A / compliance context",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          const notes = await client.query(
            `SELECT id, question, answer, rule_ref AS "ruleRef", status
             FROM kickoff_rule_notes
             WHERE org_id=$1 AND season_year=$2
             ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
             LIMIT 40`,
            [orgId, seasonYear],
          );
          let constraints: string[] = [];
          try {
            const intel = await client.query<{ summary: { constraints?: string[] } | null }>(
              `SELECT summary FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC LIMIT 1`,
              [orgId, seasonYear],
            );
            if (Array.isArray(intel.rows[0]?.summary?.constraints)) {
              constraints = intel.rows[0]!.summary!.constraints!;
            }
          } catch {
            // kickoff_game_intelligence not migrated yet
          }
          return {
            seasonYear,
            ruleNotes: notes.rows,
            constraints,
          };
        },
      }),
    )
    .register(
      tool({
        name: "rules.compliance",
        description:
          "Check a design / CAD proposal against stored game constraints and open rule notes (MODEL hints, not official rulings)",
        parseInput(value) {
          const input = object(value);
          const proposal = String(input.proposal ?? input.request ?? "").trim();
          if (!proposal) throw new Error("proposal text is required");
          if (proposal.length > 12_000) throw new Error("proposal must be 12000 characters or fewer");
          const season = seasonInput({ seasonYear: input.seasonYear });
          return { proposal, seasonYear: season.seasonYear };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          const notes = await client.query<{
            question: string;
            answer: string;
            ruleRef: string;
            status: string;
          }>(
            `SELECT question, answer, rule_ref AS "ruleRef", status
             FROM kickoff_rule_notes
             WHERE org_id=$1 AND season_year=$2
             ORDER BY created_at DESC LIMIT 40`,
            [orgId, seasonYear],
          );
          let constraints: string[] = [];
          try {
            const intel = await client.query<{ summary: { constraints?: string[] } | null }>(
              `SELECT summary FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC LIMIT 1`,
              [orgId, seasonYear],
            );
            if (Array.isArray(intel.rows[0]?.summary?.constraints)) {
              constraints = intel.rows[0]!.summary!.constraints!;
            }
          } catch {
            // optional table
          }
          const report = checkGameRuleCompliance({
            proposal: input.proposal,
            constraints,
            ruleNotes: notes.rows,
          });
          return {
            seasonYear,
            constraintCount: constraints.length,
            openRuleNotes: notes.rows.filter((row) => row.status === "open").length,
            ...report,
          };
        },
      }),
    )
    .register(
      tool({
        name: "strategy.design",
        description:
          "Read design priorities + kickoff strategy advice for the season (strategy→CAD handoff inputs)",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          const priorities = await client.query(
            `SELECT id, capability, rationale, weight, status,
                    linked_action_id AS "linkedActionId"
             FROM design_priorities
             WHERE org_id=$1 AND season_year=$2
             ORDER BY weight DESC, created_at ASC
             LIMIT 40`,
            [orgId, seasonYear],
          );
          let kickoffStrategy: Record<string, unknown> | null = null;
          try {
            const intel = await client.query(
              `SELECT id, strategy_advice AS "strategyAdvice",
                      design_priorities_draft AS "designPrioritiesDraft",
                      advice_label AS "adviceLabel", cad_job_id AS "cadJobId"
               FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC LIMIT 1`,
              [orgId, seasonYear],
            );
            kickoffStrategy = (intel.rows[0] as Record<string, unknown> | undefined) ?? null;
          } catch {
            // optional
          }
          return {
            seasonYear,
            priorities: priorities.rows,
            kickoffStrategy,
          };
        },
      }),
    )
    .register(
      tool({
        name: "cad.briefs",
        description: "Read recent CAD engineering briefs / jobs for this organization",
        parseInput(value) {
          const input = object(value);
          const limitRaw = Number(input.limit ?? 8);
          const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 8;
          return { limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          return (
            await client.query(
              `SELECT id, title, status, platform, execution_mode AS "executionMode",
                      brief, created_at AS "createdAt", updated_at AS "updatedAt"
               FROM cad_jobs
               WHERE org_id=$1
               ORDER BY updated_at DESC
               LIMIT $2`,
              [orgId, input.limit],
            )
          ).rows;
        },
      }),
    )
    .register(
      tool({
        name: "cad.vault",
        description:
          "Read this team's CAD vault: Onshape links and uploaded STEP/STL titles. STL volume is in the file's own units, never kilograms. Empty when the team has not saved any documents.",
        parseInput(value) {
          const input = object(value);
          const query = String(input.query ?? "").trim().slice(0, 160);
          const limitRaw = Number(input.limit ?? 8);
          const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 8;
          return { query, limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT d.id, d.title, d.kind, d.status,
                        d.external_url AS "externalUrl",
                        d.current_version AS "currentVersion",
                        v.filename, v.format,
                        CASE
                          WHEN v.geometry ? 'volume' AND (v.geometry->>'volume') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                          THEN (v.geometry->>'volume')::float8
                          ELSE NULL
                        END AS "stlVolumeFileUnits",
                        CASE
                          WHEN v.geometry ? 'triangleCount' AND (v.geometry->>'triangleCount') ~ '^[0-9]+$'
                          THEN (v.geometry->>'triangleCount')::int
                          ELSE NULL
                        END AS "triangleCount"
                   FROM cad_documents d
                   LEFT JOIN LATERAL (
                     SELECT filename, format, geometry
                       FROM cad_document_versions
                      WHERE document_id = d.id AND org_id = d.org_id
                      ORDER BY version DESC
                      LIMIT 1
                   ) v ON true
                  WHERE d.org_id = $1::uuid
                    AND d.status = 'active'
                    AND ($2 = '' OR concat_ws(' ', d.title, coalesce(d.description, ''), d.kind, coalesce(d.external_url, '')) ILIKE '%'||$2||'%')
                  ORDER BY d.updated_at DESC
                  LIMIT $3`,
                [orgId, input.query, input.limit],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "cad.design_context",
        description:
          "Read CAD jobs, confirmed engineering requirements, plans, and latest verified artifacts linked to a strategy match",
        parseInput(value) {
          const input = object(value);
          const matchKey = String(input.matchKey ?? "").trim().slice(0, 100);
          const limitRaw = Number(input.limit ?? 6);
          const limit = Number.isFinite(limitRaw) ? Math.min(12, Math.max(1, Math.floor(limitRaw))) : 6;
          return { matchKey, limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          return (
            await client.query(
              `SELECT j.id AS "jobId", j.title, j.status, j.platform,
                      j.brief_confirmed_at AS "briefConfirmedAt",
                      j.brief->'requirements' AS requirements,
                      j.brief->'constraints' AS constraints,
                      j.brief->'risks' AS risks,
                      j.brief->'acceptanceCriteria' AS "acceptanceCriteria",
                      j.action_plan AS "actionPlan",
                      j.updated_at AS "updatedAt",
                      latest.artifact
               FROM cad_jobs j
               LEFT JOIN LATERAL (
                 SELECT jsonb_build_object(
                   'id',a.id,'type',a.type,'title',a.title,'version',a.version,
                   'previewText',left(coalesce(a.content->>'previewText',''),1000),
                   'topologyFingerprint',coalesce(
                     a.content#>>'{topology,fingerprint}',
                     a.content#>>'{provenance,topologyFingerprint}'
                   ),
                   'provenance',a.content->'provenance','createdAt',a.created_at
                 ) AS artifact
                 FROM cad_artifacts a
                 WHERE a.org_id=j.org_id AND a.job_id=j.id AND a.type<>'engineering_brief'
                 ORDER BY a.created_at DESC LIMIT 1
               ) latest ON true
               WHERE j.org_id=$1
                 AND ($2='' OR EXISTS(
                   SELECT 1 FROM feature_context_links l
                   WHERE l.org_id=j.org_id
                     AND l.source_kind='strategy_match' AND l.source_id=$2
                     AND l.target_kind='cad_job' AND l.target_id=j.id::text
                 ))
               ORDER BY j.updated_at DESC
               LIMIT $3`,
              [orgId, input.matchKey, input.limit],
            )
          ).rows;
        },
      }),
    )
    .register(
      tool({
        name: "inventory.availability",
        description:
          "Search organization inventory and BOM availability before CAD recommends material or purchased parts",
        parseInput(value) {
          const input = object(value);
          const query = String(input.query ?? input.part ?? "").trim().slice(0, 160);
          const subsystem = String(input.subsystem ?? "").trim().slice(0, 120);
          const limitRaw = Number(input.limit ?? 20);
          const limit = Number.isFinite(limitRaw) ? Math.min(40, Math.max(1, Math.floor(limitRaw))) : 20;
          return { query, subsystem, limit };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          const items = await client.query(
            `SELECT i.id,i.name,i.category,i.part_number AS "partNumber",i.vendor,i.unit,
                    i.quantity::text AS quantity,i.min_quantity::text AS "minQuantity",
                    i.unit_cost::text AS "unitCost",i.subsystem,i.notes,l.name AS "locationName",
                    (i.quantity <= i.min_quantity) AS "lowStock"
             FROM inventory_items i
             LEFT JOIN inventory_locations l ON l.id=i.location_id
             WHERE i.org_id=$1 AND NOT i.archived
               AND ($2='' OR concat_ws(' ',i.name,i.part_number,i.vendor,i.category,i.subsystem,i.notes) ILIKE '%'||$2||'%')
               AND ($3='' OR lower(coalesce(i.subsystem,''))=lower($3))
             ORDER BY (i.quantity <= i.min_quantity) DESC,i.name LIMIT $4`,
            [orgId, input.query, input.subsystem, input.limit],
          );
          const bom = input.subsystem
            ? await client.query(
                `SELECT b.id,i.id AS "itemId",i.name,b.quantity_needed::text AS "quantityNeeded",
                        i.quantity::text AS "quantityAvailable",
                        greatest(b.quantity_needed-i.quantity,0)::text AS shortage,
                        l.name AS "locationName"
                 FROM bom_entries b JOIN inventory_items i ON i.id=b.item_id
                 LEFT JOIN inventory_locations l ON l.id=i.location_id
                 WHERE b.org_id=$1 AND lower(b.subsystem)=lower($2)
                 ORDER BY greatest(b.quantity_needed-i.quantity,0) DESC,i.name`,
                [orgId, input.subsystem],
              )
            : { rows: [] };
          return { query: input.query, subsystem: input.subsystem || null, items: items.rows, bom: bom.rows };
        },
      }),
    )
    .register(
      tool({
        name: "fmea.repeat",
        description:
          "Detect subsystems that failed repeatedly this season (failure log, with pit robot_failures fallback). Returns empty when nothing repeats — never invents counts.",
        parseInput(value) {
          const input = object(value);
          const season = seasonInput({ seasonYear: input.seasonYear });
          const thresholdRaw = Number(input.threshold ?? 2);
          const threshold = Number.isFinite(thresholdRaw)
            ? Math.min(20, Math.max(2, Math.floor(thresholdRaw)))
            : 2;
          const limitRaw = Number(input.limit ?? 12);
          const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, Math.floor(limitRaw))) : 12;
          return { seasonYear: season.seasonYear, threshold, limit };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const fmea = await client.query<{
              subsystemName: string;
              subsystemId: string | null;
              failureCount: string;
              openCount: string;
              maxRpn: string;
              titles: string[] | null;
            }>(
              `SELECT subsystem_name AS "subsystemName",
                      (array_agg(subsystem_id) FILTER (WHERE subsystem_id IS NOT NULL))[1]::text AS "subsystemId",
                      count(*)::text AS "failureCount",
                      count(*) FILTER (WHERE status IN ('open','fixing'))::text AS "openCount",
                      max(occurrence * severity * detection)::text AS "maxRpn",
                      (array_agg(title ORDER BY occurred_at DESC))[1:3] AS titles
               FROM fmea_failures
               WHERE org_id = $1::uuid AND season_year = $2
               GROUP BY lower(trim(subsystem_name)), subsystem_name
               HAVING count(*) >= $3
               ORDER BY count(*) DESC, max(occurrence * severity * detection) DESC
               LIMIT $4`,
              [orgId, seasonYear, input.threshold, input.limit],
            );
            if (fmea.rows.length) {
              const alerts = fmea.rows.map((row) => {
                const failureCount = Number(row.failureCount) || 0;
                const openCount = Number(row.openCount) || 0;
                const maxRpn = Number(row.maxRpn) || 0;
                return {
                  subsystemName: row.subsystemName,
                  subsystemId: row.subsystemId,
                  failureCount,
                  openCount,
                  maxRpn,
                  message: `${row.subsystemName} has failed ${failureCount} time${failureCount === 1 ? "" : "s"} this season (${seasonYear})`,
                  recentTitles: Array.isArray(row.titles) ? row.titles.filter(Boolean) : [],
                  href: "/fmea",
                  source: "fmea_failures",
                };
              });
              return { seasonYear, threshold: input.threshold, alerts };
            }
          } catch {
            // fmea_failures not migrated
          }

          try {
            const pit = await client.query<{
              subsystemName: string;
              failureCount: string;
              titles: string[] | null;
            }>(
              `SELECT subsystem AS "subsystemName",
                      count(*)::text AS "failureCount",
                      (array_agg(left(symptoms, 80) ORDER BY occurred_at DESC))[1:3] AS titles
               FROM robot_failures
               WHERE org_id = $1::uuid
                 AND extract(year from occurred_at AT TIME ZONE 'UTC') = $2
               GROUP BY lower(trim(subsystem)), subsystem
               HAVING count(*) >= $3
               ORDER BY count(*) DESC
               LIMIT $4`,
              [orgId, seasonYear, input.threshold, input.limit],
            );
            const alerts = pit.rows.map((row) => {
              const failureCount = Number(row.failureCount) || 0;
              return {
                subsystemName: row.subsystemName,
                subsystemId: null,
                failureCount,
                openCount: failureCount,
                maxRpn: null,
                message: `${row.subsystemName} has failed ${failureCount} time${failureCount === 1 ? "" : "s"} this season (${seasonYear})`,
                recentTitles: Array.isArray(row.titles) ? row.titles.filter(Boolean) : [],
                href: "/pit",
                source: "robot_failures",
              };
            });
            return { seasonYear, threshold: input.threshold, alerts };
          } catch {
            return { seasonYear, threshold: input.threshold, alerts: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "finance.summary",
        description:
          "Read org-scoped season budget/spend summaries (amounts, vendor/source, purpose/category). Requires Finance-in-AI opt-in. Never returns bank/card/SSN data.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          const policy = await loadOrgAiPolicy(client, orgId);
          if (!isFinanceInAiAllowed(policy)) {
            return { ...FINANCE_IN_AI_DENIED, seasonYear: input.seasonYear };
          }
          try {
            const [txns, plans, season, sponsors] = await Promise.all([
              client.query<{
                type: string;
                amountUsd: string;
                source: string;
                description: string | null;
                categoryName: string | null;
                occurredAt: string;
              }>(
                `SELECT t.type::text AS type, t.amount_usd::text AS "amountUsd",
                        t.source::text AS source, t.description,
                        c.name AS "categoryName", t.occurred_at AS "occurredAt"
                 FROM finance_transactions t
                 LEFT JOIN finance_categories c ON c.id = t.category_id
                 WHERE t.org_id=$1 AND t.season_year=$2
                 ORDER BY t.occurred_at DESC
                 LIMIT 80`,
                [orgId, input.seasonYear],
              ),
              client.query<{
                categoryName: string;
                monthlyLimitUsd: string | null;
                totalLimitUsd: string | null;
              }>(
                `SELECT c.name AS "categoryName",
                        p.monthly_limit_usd::text AS "monthlyLimitUsd",
                        p.total_limit_usd::text AS "totalLimitUsd"
                 FROM finance_budget_plans p
                 JOIN finance_categories c ON c.id = p.category_id
                 WHERE c.org_id=$1 AND c.season_year=$2
                 ORDER BY c.name
                 LIMIT 40`,
                [orgId, input.seasonYear],
              ),
              client.query<{
                operatingBudgetUsd: string;
                fundraisingGoalUsd: string;
              }>(
                `SELECT operating_budget_usd::text AS "operatingBudgetUsd",
                        fundraising_goal_usd::text AS "fundraisingGoalUsd"
                 FROM finance_season_settings WHERE org_id=$1 AND season_year=$2`,
                [orgId, input.seasonYear],
              ),
              client.query<{ cashUsd: string }>(
                `SELECT COALESCE(sum(amount_usd),0)::text AS "cashUsd"
                 FROM sponsor_contributions
                 WHERE org_id=$1 AND season_year=$2 AND type='cash'`,
                [orgId, input.seasonYear],
              ),
            ]);

            let incomeUsd = 0;
            let expenseUsd = 0;
            const recent = txns.rows.map((row) => {
              const amount = Number(row.amountUsd) || 0;
              if (row.type === "income") incomeUsd += amount;
              else expenseUsd += amount;
              return {
                type: row.type,
                amountUsd: amount,
                source: row.source,
                purpose: row.description,
                category: row.categoryName,
                occurredAt: row.occurredAt,
              };
            });
            incomeUsd = round2(incomeUsd);
            expenseUsd = round2(expenseUsd);

            const payload = {
              seasonYear: input.seasonYear,
              operatingBudgetUsd: Number(season.rows[0]?.operatingBudgetUsd ?? 0) || 0,
              fundraisingGoalUsd: Number(season.rows[0]?.fundraisingGoalUsd ?? 0) || 0,
              sponsorCashUsd: Number(sponsors.rows[0]?.cashUsd ?? 0) || 0,
              incomeUsd,
              expenseUsd,
              netUsd: round2(incomeUsd - expenseUsd),
              categoryLimits: plans.rows.map((row) => ({
                category: row.categoryName,
                monthlyLimitUsd: row.monthlyLimitUsd == null ? null : Number(row.monthlyLimitUsd) || 0,
                totalLimitUsd: row.totalLimitUsd == null ? null : Number(row.totalLimitUsd) || 0,
              })),
              recentTransactions: recent,
            };
            return sanitizeFinancePayloadForAi(payload);
          } catch {
            return {
              seasonYear: input.seasonYear,
              setup_required: true,
              message: "Team finance tables are not available yet.",
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "finance.orders",
        description:
          "List open purchase / ordering requests for the season. Requires Finance-in-AI opt-in. Never returns card/bank data.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          const policy = await loadOrgAiPolicy(client, orgId);
          if (!isFinanceInAiAllowed(policy)) {
            return { ...FINANCE_IN_AI_DENIED, seasonYear: input.seasonYear, orders: [], aiSummary: null };
          }
          try {
            const rows = await client.query<{
              id: string;
              title: string;
              status: string;
              totalCostUsd: string;
              itemUrl: string | null;
              buyerUserId: string | null;
              quantity: number;
              vendor: string;
              justification: string | null;
            }>(
              `SELECT pr.id, pr.title, pr.status::text AS status,
                      pr.total_cost_usd::text AS "totalCostUsd",
                      pr.item_url AS "itemUrl",
                      pr.buyer_user_id::text AS "buyerUserId",
                      pr.quantity, pr.vendor, pr.justification
               FROM purchase_requests pr
               WHERE pr.org_id=$1 AND pr.season_year=$2
                 AND pr.status::text IN ('pending','approved','ordered')
               ORDER BY CASE pr.status::text WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                        pr.created_at DESC
               LIMIT 40`,
              [orgId, input.seasonYear],
            );
            const orders = rows.rows.map((row) => ({
              id: row.id,
              title: row.title,
              status: row.status,
              totalCostUsd: Number(row.totalCostUsd) || 0,
              itemUrl: row.itemUrl,
              buyerUserId: row.buyerUserId,
              quantity: row.quantity,
              vendor: row.vendor,
              purpose: row.justification,
            }));
            return sanitizeFinancePayloadForAi({
              seasonYear: input.seasonYear,
              orders,
              aiSummary: summarizeOpenPurchaseRequests(orders),
            });
          } catch {
            return {
              seasonYear: input.seasonYear,
              orders: [],
              aiSummary: null,
              setup_required: true,
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "finance.create_purchase_request",
        description:
          "Create a pending purchase request (what/why/estimate/optional vendor URL). Requires Finance-in-AI opt-in. Never stores card or bank data.",
        parseInput(value) {
          const input = object(value);
          const title = String(input.title ?? input.partName ?? input.itemName ?? "").trim();
          if (!title) throw new Error("title (part/item name) is required");
          if (title.length > 200) throw new Error("title must be 200 characters or fewer");
          const justification = String(input.justification ?? input.why ?? input.purpose ?? "").trim();
          if (!justification) throw new Error("justification (why you need it) is required");
          if (justification.length > 2000) throw new Error("justification must be 2000 characters or fewer");
          const quantityRaw = Number(input.quantity ?? 1);
          if (!Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > 9999) {
            throw new Error("quantity must be a whole number from 1 to 9999");
          }
          const estimateUsd = Number(input.estimateUsd ?? input.unitCostUsd ?? 0);
          if (!Number.isFinite(estimateUsd) || estimateUsd < 0 || estimateUsd > 1_000_000) {
            throw new Error("estimateUsd must be a non-negative dollar amount");
          }
          const itemUrlRaw = typeof input.itemUrl === "string" ? input.itemUrl.trim() : "";
          let itemUrl: string | null = null;
          if (itemUrlRaw) {
            try {
              const parsed = new URL(itemUrlRaw);
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                throw new Error("itemUrl must be http(s)");
              }
              itemUrl = parsed.toString();
            } catch {
              throw new Error("itemUrl must be a valid URL");
            }
          }
          const vendor = String(input.vendor ?? "unspecified").trim().slice(0, 120) || "unspecified";
          const season = seasonInput({ seasonYear: input.seasonYear });
          const source = String(input.source ?? "assistant").trim().slice(0, 40) || "assistant";
          return {
            title: title.slice(0, 200),
            justification: justification.slice(0, 2000),
            quantity: quantityRaw,
            estimateUsd: round2(estimateUsd),
            itemUrl,
            vendor,
            seasonYear: season.seasonYear,
            source,
          };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, userId }, input) {
          const policy = await loadOrgAiPolicy(client, orgId);
          if (!isFinanceInAiAllowed(policy)) {
            return { ...FINANCE_IN_AI_DENIED, created: false };
          }
          const unitCostUsd =
            input.quantity <= 1 ? input.estimateUsd : round2(input.estimateUsd / input.quantity);
          const totalCostUsd =
            input.quantity <= 1 ? input.estimateUsd : round2(input.quantity * unitCostUsd);
          try {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO purchase_requests(
                 org_id, season_year, requested_by, title, vendor, item_url,
                 quantity, unit_cost_usd, total_cost_usd, justification
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id`,
              [
                orgId,
                input.seasonYear,
                userId,
                input.title,
                input.vendor,
                input.itemUrl,
                input.quantity,
                unitCostUsd,
                totalCostUsd,
                `${input.justification}${input.source === "cad" ? "\n\n(Source: CAD)" : ""}`,
              ],
            );
            const orderId = inserted.rows[0]!.id;
            const requester = await client.query<{ name: string | null }>(`SELECT name FROM users WHERE id=$1`, [
              userId,
            ]);
            const admins = await client.query<{ userId: string }>(
              `SELECT user_id AS "userId" FROM memberships
               WHERE org_id=$1 AND role IN ('owner','admin') AND user_id <> $2`,
              [orgId, userId],
            );
            const href = `/orders?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(orderId)}`;
            for (const admin of admins.rows) {
              await client.query(
                `INSERT INTO notifications (user_id, org_id, type, payload) VALUES ($1,$2,$3,$4::jsonb)`,
                [
                  admin.userId,
                  orgId,
                  "purchase_request_submitted",
                  JSON.stringify({
                    title: "New purchase request",
                    body: `${requester.rows[0]?.name ?? "A teammate"} requested “${input.title}” (~$${totalCostUsd.toFixed(2)}).`,
                    orderId,
                    href,
                    source: input.source,
                  }),
                ],
              );
            }
            return sanitizeFinancePayloadForAi({
              created: true,
              orderId,
              title: input.title,
              totalCostUsd,
              status: "pending",
              href,
              message: `Purchase request submitted for admin approval. Open ${href} to track it.`,
            });
          } catch (error) {
            return {
              created: false,
              setup_required: true,
              error: error instanceof Error ? error.message : "Could not create purchase request",
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "fmea.open_risks",
        description:
          "Read open / fixing failure-log rows ranked by priority — CAD and strategy treat these as real reliability risks",
        parseInput(value) {
          const season = seasonInput(value);
          const input = object(value);
          const limitRaw = Number(input.limit ?? 12);
          const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, Math.floor(limitRaw))) : 12;
          return { seasonYear: season.seasonYear, limit };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, title, failure_mode AS "failureMode", subsystem_name AS "subsystemName",
                      context, status, occurrence, severity, detection,
                      (occurrence * severity * detection) AS rpn,
                      root_cause AS "rootCause", fix,
                      event_key AS "eventKey", match_key AS "matchKey",
                      occurred_at AS "occurredAt"
               FROM fmea_failures
               WHERE org_id=$1 AND season_year=$2 AND status IN ('open','fixing')
               ORDER BY (occurrence * severity * detection) DESC, occurred_at DESC
               LIMIT $3`,
              [orgId, seasonYear, input.limit],
            );
            return { seasonYear, failures: rows.rows, openCount: rows.rows.length };
          } catch {
            return { seasonYear, failures: [], openCount: 0, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "cad.create_brief",
        description:
          "Create a metered CAD engineering brief grounded in strategy.match, kickoff design priorities, failure-log risks, and knowledge (shared tool graph — no copy-paste)",
        parseInput(value) {
          const input = object(value);
          const request = String(input.request ?? input.proposal ?? "").trim();
          if (!request) throw new Error("request is required");
          if (request.length > 12_000) throw new Error("request must be 12000 characters or fewer");
          const title = String(input.title ?? request).trim().slice(0, 160) || "CAD engineering brief";
          const matchKey = String(input.matchKey ?? "").trim() || undefined;
          const season = seasonInput({ seasonYear: input.seasonYear });
          return { request, title, matchKey, seasonYear: season.seasonYear };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, userId, activeEventKey }, input): Promise<Record<string, unknown>> {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey, input.matchKey);
          const { createMeteredCadBriefJob } = await import("./cad-brief");
          try {
            const created = await createMeteredCadBriefJob(client, {
              orgId,
              userId,
              title: input.title,
              request: input.request,
              seasonYear,
              selected: input.matchKey ? { matchKey: input.matchKey } : undefined,
              sources: [],
              // Parent chat/strategy turn already meters — avoid a nested ledger hit.
              inheritMetering: true,
            });
            return {
              jobId: created.jobId,
              status: created.status,
              aiRunId: created.aiRunId,
              title: input.title,
              summary: created.brief.summary,
              requirementCount: created.brief.requirements.length,
              riskCount: created.brief.risks.length,
              tools: created.tools.map((t: { name: string; status: string; summary?: string }) => ({
                name: t.name,
                status: t.status,
                summary: t.summary,
              })),
            };
          } catch (error) {
            return {
              jobId: null,
              status: "failed",
              error: error instanceof Error ? error.message : "CAD brief creation failed",
            };
          }
        },
      }),
    )
    .register(
      tool({
        name: "my_day.summary",
        description:
          "Read next-match / bumper / lodging cues for competition My Day. Empty when unset - never invents schedule times.",
        parseInput(value) {
          object(value);
          return {};
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, userId, activeEventKey }) {
          try {
            const org = await client.query<{
              teamNumber: number | null;
              eventKey: string | null;
              eventName: string | null;
            }>(
              `SELECT o.team_number AS "teamNumber",
                      coalesce($2::text, c.active_event_key) AS "eventKey",
                      e.name AS "eventName"
               FROM organizations o
               LEFT JOIN org_active_context c ON c.org_id = o.id
               LEFT JOIN events_ref e ON e.event_key = coalesce($2::text, c.active_event_key)
               WHERE o.id=$1::uuid`,
              [orgId, activeEventKey ?? null],
            );
            const row = org.rows[0];
            if (!row?.teamNumber || !row.eventKey) {
              return { nextMatch: null, emptyReason: !row?.eventKey ? "no_active_event" : "no_team_number" };
            }
            const teamKey = `frc${row.teamNumber}`;
            const matches = await client.query<{
              matchKey: string; compLevel: string; matchNumber: number; scheduledTime: string | null;
              red: { teamKeys?: string[] } | null; blue: { teamKeys?: string[] } | null;
              redScore: number | null; blueScore: number | null;
            }>(
              `SELECT match_key AS "matchKey", comp_level AS "compLevel", match_number AS "matchNumber",
                      COALESCE(actual_time, predicted_time, event_time)::text AS "scheduledTime",
                      red_alliance AS red, blue_alliance AS blue,
                      NULLIF(red_alliance->>'score','')::float AS "redScore",
                      NULLIF(blue_alliance->>'score','')::float AS "blueScore"
               FROM matches_ref WHERE event_key=$1
               ORDER BY CASE comp_level WHEN 'qm' THEN 0 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5 END, match_number`,
              [row.eventKey],
            );
            const next = matches.rows.find((m) => {
              const keys = [...(m.red?.teamKeys ?? []), ...(m.blue?.teamKeys ?? [])];
              return keys.includes(teamKey) && m.redScore == null && m.blueScore == null;
            });
            const side = next
              ? (next.red?.teamKeys ?? []).includes(teamKey) ? "red"
                : (next.blue?.teamKeys ?? []).includes(teamKey) ? "blue" : null
              : null;
            let lodging: unknown = null;
            let nextTravel: unknown = null;
            try {
              lodging = (await client.query(
                `SELECT h.name AS "hotelName", r.room_label AS "roomLabel"
                 FROM logistics_room_assignments r JOIN logistics_hotels h ON h.id=r.hotel_id
                 WHERE r.org_id=$1::uuid AND r.occupant_user_id=$2::uuid LIMIT 1`,
                [orgId, userId],
              )).rows[0] ?? null;
            } catch { /* optional */ }
            try {
              nextTravel = (await client.query(
                `SELECT title, starts_at::text AS "startsAt", meeting_point AS "meetingPoint"
                 FROM logistics_travel_legs
                 WHERE org_id=$1::uuid AND starts_at >= now() - interval '30 minutes'
                 ORDER BY starts_at ASC LIMIT 1`,
                [orgId],
              )).rows[0] ?? null;
            } catch { /* optional */ }
            return {
              eventKey: row.eventKey, eventName: row.eventName, teamKey,
              nextMatch: next ? {
                matchKey: next.matchKey,
                label: `${next.compLevel} ${next.matchNumber}`,
                scheduledTime: next.scheduledTime,
                alliance: side,
                bumperCue: side === "red" ? "Switch to RED bumpers" : side === "blue" ? "Switch to BLUE bumpers" : "Alliance TBD",
              } : null,
              lodging, nextTravel, href: "/my-day",
            };
          } catch {
            return { nextMatch: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "calendar.upcoming",
        description: "List upcoming team/subteam calendar events. Returns empty when nothing is scheduled - never invents events.",
        parseInput(value) {
          const input = object(value);
          const limitRaw = Number(input.limit ?? 8);
          const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 8;
          return { limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (await client.query(
              `SELECT id::text AS id, title, kind, starts_at AS "startsAt", ends_at AS "endsAt", location
               FROM subteam_calendar_events
               WHERE org_id=$1::uuid AND starts_at >= now() - interval '1 day'
               ORDER BY starts_at ASC LIMIT $2`,
              [orgId, input.limit],
            )).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    // ---------------------------------------------------------------------------
    // Feature-manifest grounded read-only tools (generated from
    // apps/web/lib/manifests/*.manifest.ts aiTools). Each is org-scoped, uses only
    // real columns, and degrades to an empty / setup_required state — never
    // fabricates rows. Ordered by manifest slug for determinism.
    // ---------------------------------------------------------------------------
    .register(
      tool({
        name: "alliance_partner_brief.brief",
        description:
          "Read this org's generated alliance-partner brief (role, strengths, evidence) for a finalized alliance seed at an event.",
        parseInput(value) {
          const input = object(value);
          const eventKey = String(input.eventKey ?? "").trim().slice(0, 40) || null;
          const seedRaw = Number(input.allianceSeed ?? input.seed);
          const allianceSeed =
            Number.isInteger(seedRaw) && seedRaw > 0 && seedRaw <= 64 ? seedRaw : null;
          return { eventKey, allianceSeed };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const eventKey = input.eventKey ?? activeEventKey;
          if (!eventKey) return { eventKey: null, briefs: [], emptyReason: "no_active_event" };
          try {
            const rows = await client.query(
              `SELECT id, event_key AS "eventKey", alliance_seed AS "allianceSeed",
                      our_team_key AS "ourTeamKey", partner_team_keys AS "partnerTeamKeys",
                      partners, created_at AS "createdAt"
               FROM alliance_partner_brief_briefs
               WHERE org_id=$1 AND event_key=$2 AND ($3::int IS NULL OR alliance_seed=$3)
               ORDER BY alliance_seed ASC, created_at DESC
               LIMIT 20`,
              [orgId, eventKey, input.allianceSeed],
            );
            return { eventKey, briefs: rows.rows };
          } catch {
            return { eventKey, briefs: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "budget_reconciler.reports",
        description:
          "Read this org's weight/power budget reconciliation runs for the active season — as-designed mass vs. weight limit, current draw vs. summed breaker budget, drift status, and the proposed subsystem to trim with amount and rationale.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, mass_total_lbs::text AS "massTotalLbs", mass_limit_lbs::text AS "massLimitLbs",
                      mass_drift_lbs::text AS "massDriftLbs", mass_status AS "massStatus",
                      current_total_amps::text AS "currentTotalAmps",
                      current_breaker_amps::text AS "currentBreakerAmps",
                      current_drift_amps::text AS "currentDriftAmps", current_status AS "currentStatus",
                      trim_subsystem AS "trimSubsystem", trim_amount_lbs::text AS "trimAmountLbs",
                      rationale, confidence::text AS confidence, created_at AS "createdAt"
               FROM budget_reconciler_reports
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, reports: rows.rows };
          } catch {
            return { seasonYear, reports: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "code_perf.changes",
        description:
          "Read this org's logged commits/software-version/tuning changes for the active season, including the computed before/after match-window correlation (verdict, delta auto/teleop points, rationale).",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, occurred_on AS "occurredOn", change_type AS "changeType", subsystem,
                      title, commit_sha AS "commitSha", verdict,
                      delta_auto::text AS "deltaAuto", delta_teleop::text AS "deltaTeleop",
                      delta_total::text AS "deltaTotal", matches_before AS "matchesBefore",
                      matches_after AS "matchesAfter", rationale, analyzed_at AS "analyzedAt",
                      created_at AS "createdAt"
               FROM code_perf_changes
               WHERE org_id=$1 AND season_year=$2
               ORDER BY occurred_on DESC, created_at DESC
               LIMIT 40`,
              [orgId, seasonYear],
            );
            return { seasonYear, changes: rows.rows };
          } catch {
            return { seasonYear, changes: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "counter_book.reports",
        description:
          "Read this org's generated opponent counter-books (tendencies, failure triggers, counter plan) for a team key.",
        parseInput(value) {
          const input = object(value);
          const raw = String(input.teamKey ?? "").trim();
          const teamKey = raw && /^frc\d+$/.test(raw) ? raw : null;
          return { teamKey };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id, team_key AS "teamKey", team_number AS "teamNumber",
                        event_key AS "eventKey", title, matches_scouted AS "matchesScouted",
                        tendencies, failure_triggers AS "failureTriggers",
                        counter_plan AS "counterPlan", summary, created_at AS "createdAt"
                 FROM counter_book_reports
                 WHERE org_id=$1 AND ($2::text IS NULL OR team_key=$2)
                 ORDER BY created_at DESC
                 LIMIT 20`,
                [orgId, input.teamKey],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "decision_critic.reviews",
        description:
          "Read this org's logged design-decision second opinions for the active season, including the verdict (proceed, proceed with caution, or reconsider), concerns grounded in weight/power headroom and failure-log history, confidence, and recorded outcome.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, subsystem_name AS "subsystemName", title, category, verdict,
                      confidence::text AS confidence, concerns, recommendation, outcome,
                      weight_added_lbs::text AS "weightAddedLbs",
                      weight_margin_lbs::text AS "weightMarginLbs",
                      power_added_amps::text AS "powerAddedAmps",
                      power_headroom_amps::text AS "powerHeadroomAmps",
                      chronic_failure_count AS "chronicFailureCount", created_at AS "createdAt"
               FROM decision_critic_reviews
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, reviews: rows.rows };
          } catch {
            return { seasonYear, reviews: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "decision_search.search",
        description:
          "Grounded semantic search over the org's indexed decisions, design reviews, and notebook entries. Ranks by deterministic term overlap; never fabricates a match.",
        parseInput(value) {
          const input = object(value);
          const query = String(input.query ?? "").trim();
          if (!query) throw new Error("query is required");
          const limit = Math.min(Math.max(Number(input.limit ?? 8) || 8, 1), 20);
          return { query: query.slice(0, 200), limit };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id::text AS id, source_kind AS "sourceKind", source_id AS "sourceId",
                        title, left(coalesce(body,''), 280) AS snippet,
                        season_year AS "seasonYear", tags
                 FROM decision_search_documents
                 WHERE org_id=$1::uuid
                   AND (
                     to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
                       @@ plainto_tsquery('english', $2)
                     OR title ILIKE '%' || $2 || '%'
                     OR body ILIKE '%' || $2 || '%'
                   )
                 ORDER BY ts_rank(
                            to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')),
                            plainto_tsquery('english', $2)
                          ) DESC, created_at DESC
                 LIMIT $3`,
                [orgId, input.query, input.limit],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "defense_planner.matchups",
        description:
          "Read this org's scouted defensive matchups (opponent mass/drivetrain/cycle path) and the computed play/stay-offense recommendation for the active season.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, opponent_team_number AS "opponentTeamNumber",
                      opponent_team_name AS "opponentTeamName", event_key AS "eventKey",
                      opponent_mass_lbs::text AS "opponentMassLbs",
                      opponent_drivetrain_type AS "opponentDrivetrainType",
                      opponent_cycle_time_sec::text AS "opponentCycleTimeSec",
                      opponent_cycle_path AS "opponentCyclePath",
                      recommendation, assigned_defender AS "assignedDefender",
                      confidence::text AS confidence, rationale, updated_at AS "updatedAt"
               FROM defense_planner_matchups
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, matchups: rows.rows };
          } catch {
            return { seasonYear, matchups: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "impact_essay.draft",
        description:
          "Read this org's grounded FIRST Impact / Engineering Inspiration essay drafts and the underlying record counts (outreach activities, build hours, sponsors, team events) each draft cites.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, award, prompt, essay_text AS "essayText",
                      word_count AS "wordCount", citations, created_at AS "createdAt"
               FROM impact_essay_drafts
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 10`,
              [orgId, seasonYear],
            );
            return { seasonYear, drafts: rows.rows };
          } catch {
            return { seasonYear, drafts: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "inspection_copilot.checks",
        description:
          "Read this org's inspection-readiness checks for the active season, including predicted failures (weight/bumper/frame-perimeter/breaker/battery/wiring/radio faults) with risk score.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, robot_name AS "robotName", weight_budget AS "weightBudget",
                      frame_bumper AS "frameBumper", wiring_power AS "wiringPower", flags,
                      risk_score::text AS "riskScore", total_weight_lbs::text AS "totalWeightLbs",
                      summary, updated_at AS "updatedAt"
               FROM inspection_copilot_checks
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, checks: rows.rows };
          } catch {
            return { seasonYear, checks: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "judge_sim.sessions",
        description:
          "Read this org's graded judge Q&A practice sessions for the active season, including the question, category, verdict (well backed, partially backed, or unbacked), confidence, and any claims flagged as unbacked by logged evidence.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, category, question, answer_text AS "answerText", verdict,
                      confidence::text AS confidence, backed_claims AS "backedClaims",
                      flagged_claims AS "flaggedClaims", feedback, created_at AS "createdAt"
               FROM judge_sim_sessions
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, sessions: rows.rows };
          } catch {
            return { seasonYear, sessions: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "judge_sim.evidence",
        description:
          "Read this org's logged judge-pitch evidence — the facts, numbers, and outcomes the team can point to when answering judging questions, grouped by category.",
        parseInput(value) {
          const input = object(value);
          const category = String(input.category ?? "").trim().slice(0, 40) || null;
          return { category };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id, title, claim, category, source_url AS "sourceUrl",
                        occurred_on AS "occurredOn", tags, created_at AS "createdAt"
                 FROM judge_sim_evidence
                 WHERE org_id=$1 AND ($2::text IS NULL OR category=$2)
                 ORDER BY category ASC, created_at DESC
                 LIMIT 40`,
                [orgId, input.category],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "knowledge_gap.scan_summary",
        description:
          "Grounded read of the latest knowledge-gap scan for the org's active season: coverage score and the list of undocumented subsystems/decisions/events, with no invented rows.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const scan = await client.query<{ id: string }>(
              `SELECT id, subsystem_count AS "subsystemCount", decision_count AS "decisionCount",
                      event_count AS "eventCount", page_count AS "pageCount",
                      gap_count AS "gapCount", coverage_score::text AS "coverageScore",
                      summary, created_at AS "createdAt"
               FROM knowledge_gap_scans
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 1`,
              [orgId, seasonYear],
            );
            const row = scan.rows[0];
            if (!row) return { seasonYear, scan: null, gaps: [] };
            const items = await client.query(
              `SELECT id, subject_kind AS "subjectKind", subject_ref AS "subjectRef",
                      reason, suggested_template AS "suggestedTemplate", status
               FROM knowledge_gap_items
               WHERE org_id=$1 AND scan_id=$2 AND status='open'
               ORDER BY created_at ASC
               LIMIT 60`,
              [orgId, row.id],
            );
            return { seasonYear, scan: row, gaps: items.rows };
          } catch {
            return { seasonYear, scan: null, gaps: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "match_copilot.brief",
        description:
          "Grounded read of the next-match brief: opponent scouting and season ratings, our stored strategy plan, open failure risks, and battery fleet health fused into prioritized do-this callouts.",
        parseInput(value) {
          const input = object(value);
          const matchKey = String(input.matchKey ?? "").trim().slice(0, 100) || null;
          return { matchKey };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          try {
            const rows = await client.query(
              `SELECT id, match_key AS "matchKey", alliance, callouts,
                      generated_by AS "generatedBy", created_at AS "createdAt"
               FROM match_copilot_briefs
               WHERE org_id=$1 AND ($2::text IS NULL OR match_key=$2)
               ORDER BY created_at DESC
               LIMIT 10`,
              [orgId, input.matchKey],
            );
            return { matchKey: input.matchKey, briefs: rows.rows };
          } catch {
            return { matchKey: input.matchKey, briefs: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "media_kit.profile",
        description:
          "Read this org's recorded media-kit team profile for a season — mission statement, bio, founded year, achievements, and contact info.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT mission_statement AS "missionStatement", team_bio AS "teamBio",
                      founded_year AS "foundedYear", achievements,
                      contact_email AS "contactEmail", website_url AS "websiteUrl",
                      updated_at AS "updatedAt"
               FROM media_kit_profiles
               WHERE org_id=$1 AND season_year=$2
               LIMIT 1`,
              [orgId, seasonYear],
            );
            return { seasonYear, profile: rows.rows[0] ?? null };
          } catch {
            return { seasonYear, profile: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "media_kit.one_pagers",
        description:
          "Read this org's generated media-kit one-pager documents for a season, built only from the recorded profile and asset library.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, title, sections, created_at AS "createdAt"
               FROM media_kit_documents
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, documents: rows.rows };
          } catch {
            return { seasonYear, documents: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "meeting_autopilot.agenda",
        description:
          "Read-only: the ranked meeting agenda grounded in open blockers, overdue tasks, unresolved decisions, and open failure-log rows for the org's active season.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, title, meeting_on AS "meetingOn", agenda_items AS "agendaItems",
                      blocker_count AS "blockerCount", overdue_task_count AS "overdueTaskCount",
                      decision_count AS "decisionCount", fmea_count AS "fmeaCount",
                      status, updated_at AS "updatedAt"
               FROM meeting_autopilot_agendas
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 10`,
              [orgId, seasonYear],
            );
            return { seasonYear, agendas: rows.rows };
          } catch {
            return { seasonYear, agendas: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "meeting_autopilot.action_items",
        description: "Read-only: action items deterministically drafted from a meeting's post-meeting minutes.",
        parseInput(value) {
          const input = object(value);
          const raw = String(input.agendaId ?? "").trim();
          const agendaId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
          return { agendaId };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id, agenda_id AS "agendaId", title, owner, due_on AS "dueOn",
                        status, source_excerpt AS "sourceExcerpt", created_at AS "createdAt"
                 FROM meeting_autopilot_action_items
                 WHERE org_id=$1 AND ($2::uuid IS NULL OR agenda_id=$2::uuid)
                 ORDER BY created_at DESC
                 LIMIT 40`,
                [orgId, input.agendaId],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "mock_judging.sessions",
        description:
          "Read this org's rubric-scored mock judging practice sessions for the active season, including the award category, question, answer, per-criterion scores, strengths, and improvement suggestions.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, award_category AS "awardCategory", question, answer_text AS "answerText",
                      criteria_scores AS "criteriaScores", overall_score::text AS "overallScore",
                      strengths, improvements, feedback, created_at AS "createdAt"
               FROM mock_judging_sessions
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, sessions: rows.rows };
          } catch {
            return { seasonYear, sessions: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "mock_judging.prep_notes",
        description:
          "Read this org's logged mock-judging prep notes — the talking points and facts the team can point to for judges, grouped by award category.",
        parseInput(value) {
          const input = object(value);
          const awardCategory = String(input.awardCategory ?? input.category ?? "").trim().slice(0, 40) || null;
          return { awardCategory };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id, title, note, award_category AS "awardCategory", tags, created_at AS "createdAt"
                 FROM mock_judging_prep_notes
                 WHERE org_id=$1 AND ($2::text IS NULL OR award_category=$2)
                 ORDER BY award_category ASC, created_at DESC
                 LIMIT 40`,
                [orgId, input.awardCategory],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "onboarding_buddy.pairings",
        description:
          "Read this org's onboarding buddy pairings: which new members are paired with which tenured buddy, pairing status, and first-week plan progress.",
        parseInput(value) {
          object(value);
          return {};
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }) {
          try {
            return (
              await client.query(
                `SELECT p.id, p.new_member_id::text AS "newMemberId", nm.name AS "newMemberName",
                        p.buddy_id::text AS "buddyId", bud.name AS "buddyName",
                        p.status, p.paired_at AS "pairedAt",
                        count(pi.id)::int AS "planItemCount",
                        count(pi.id) FILTER (WHERE pi.done)::int AS "planItemsDone"
                 FROM onboarding_buddy_pairings p
                 LEFT JOIN users nm ON nm.id = p.new_member_id
                 LEFT JOIN users bud ON bud.id = p.buddy_id
                 LEFT JOIN onboarding_buddy_plan_items pi ON pi.pairing_id = p.id AND pi.org_id = p.org_id
                 WHERE p.org_id=$1
                 GROUP BY p.id, nm.name, bud.name
                 ORDER BY p.paired_at DESC
                 LIMIT 40`,
                [orgId],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "overnight_intel.latest_brief",
        description:
          "Grounded read of the org's most recent overnight event-intel brief — new research findings, season-score movers, and new scouting for the active event.",
        parseInput(value) {
          const input = object(value);
          const eventKey = String(input.eventKey ?? "").trim().slice(0, 40) || null;
          return { eventKey };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const eventKey = input.eventKey ?? activeEventKey;
          if (!eventKey) return { eventKey: null, brief: null, emptyReason: "no_active_event" };
          try {
            const rows = await client.query(
              `SELECT id, event_key AS "eventKey", season_year AS "seasonYear",
                      brief_date AS "briefDate", summary,
                      research_highlights AS "researchHighlights", epa_movers AS "epaMovers",
                      scouting_highlights AS "scoutingHighlights", created_at AS "createdAt"
               FROM overnight_intel_briefs
               WHERE org_id=$1 AND event_key=$2
               ORDER BY brief_date DESC, created_at DESC
               LIMIT 1`,
              [orgId, eventKey],
            );
            return { eventKey, brief: rows.rows[0] ?? null };
          } catch {
            return { eventKey, brief: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "picklist_justifier.entries",
        description:
          "Read this org's generated pick-list justifications (source-cited rationale + official-result contradiction flags) for a pick list.",
        parseInput(value) {
          const input = object(value);
          const raw = String(input.pickListId ?? "").trim();
          const pickListId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
          return { pickListId };
        },
        parseOutput: rowsOutput,
        async execute({ client, orgId }, input) {
          try {
            return (
              await client.query(
                `SELECT id, pick_list_id AS "pickListId", team_key AS "teamKey", rationale,
                        sources, contradiction_flagged AS "contradictionFlagged",
                        contradiction_reason AS "contradictionReason", created_at AS "createdAt"
                 FROM picklist_justifier_justifications
                 WHERE org_id=$1 AND ($2::uuid IS NULL OR pick_list_id=$2::uuid)
                 ORDER BY created_at DESC
                 LIMIT 40`,
                [orgId, input.pickListId],
              )
            ).rows;
          } catch {
            return [];
          }
        },
      }),
    )
    .register(
      tool({
        name: "pit_repair_triage.reports",
        description:
          "Read this org's logged pit-repair failures for the active season, including the failure-log history + spares-inventory + remaining-match-time triage decision (fix, swap, or monitor), confidence, and pre-stage recommendation.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, subsystem_name AS "subsystemName", title, symptom_note AS "symptomNote",
                      minutes_until_next_match AS "minutesUntilNextMatch", severity,
                      prior_failure_count AS "priorFailureCount",
                      spares_available::text AS "sparesAvailable", decision,
                      confidence::text AS confidence, rationale,
                      prestage_recommended AS "prestageRecommended", status,
                      created_at AS "createdAt"
               FROM pit_repair_triage_reports
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, reports: rows.rows };
          } catch {
            return { seasonYear, reports: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "prototype_tracker.decisions",
        description:
          "Read this org's logged prototype tests (hypothesis, outcome, metric vs. target) and the decision records + notebook entries drafted from them, including recommendation (adopt, iterate, reject, needs more data) and confidence.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT d.id, d.decision_title AS "decisionTitle", d.recommendation,
                      d.confidence::text AS confidence, d.decision_record AS "decisionRecord",
                      d.status, t.id AS "testId", t.subsystem_name AS "subsystemName",
                      t.title AS "testTitle", t.hypothesis, t.outcome,
                      t.metric_label AS "metricLabel", t.metric_value::text AS "metricValue",
                      t.metric_target::text AS "metricTarget", d.created_at AS "createdAt"
               FROM prototype_tracker_decisions d
               JOIN prototype_tracker_tests t ON t.id = d.test_id AND t.org_id = d.org_id
               WHERE d.org_id=$1 AND t.season_year=$2
               ORDER BY d.created_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, decisions: rows.rows };
          } catch {
            return { seasonYear, decisions: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "readiness_score.index",
        description:
          "Read this org's grounded ship-readiness index for the active season: subsystem wiring + code-version state, weight/power headroom against FRC budgets, bring-up checklist completion, open failure-log clearance, and the severity-ordered fix list.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            // Readiness reads the build tools that own each number (see migration
            // 0519): roster from robot_subsystems, weight from weight_components,
            // current draw from power_loads, wiring/code from the sign-off gates.
            const subsystems = await client.query(
              `SELECT s.id,
                      s.name,
                      COALESCE(w.total, 0)::text AS "weightLbs",
                      COALESCE(p.total, 0)::text AS "powerDrawAmps",
                      CASE g.wiring WHEN 'approved' THEN 'verified'
                                    WHEN 'rejected' THEN 'in_progress'
                                    ELSE 'not_started' END AS "wiringStatus",
                      CASE g.programming WHEN 'approved' THEN 'deployed_tested'
                                         WHEN 'rejected' THEN 'building'
                                         ELSE 'stale' END AS "codeVersionStatus",
                      s.updated_at AS "updatedAt"
                 FROM robot_subsystems s
                 LEFT JOIN (
                        SELECT lower(btrim(subsystem)) AS k, SUM(weight_lbs * quantity) AS total
                          FROM weight_components
                         WHERE org_id=$1::uuid AND season_year=$2::int
                         GROUP BY 1
                      ) w ON w.k = lower(btrim(s.name))
                 LEFT JOIN (
                        SELECT lower(btrim(subsystem)) AS k, SUM(COALESCE(typical_amps, 0)) AS total
                          FROM power_loads
                         WHERE org_id=$1::uuid AND season_year=$2::int
                         GROUP BY 1
                      ) p ON p.k = lower(btrim(s.name))
                 LEFT JOIN (
                        SELECT lower(btrim(sg.name)) AS k,
                               MAX(r.decision) FILTER (WHERE r.gate='wiring') AS wiring,
                               MAX(r.decision) FILTER (WHERE r.gate='programming') AS programming
                          FROM subsystem_signoff_records r
                          JOIN subsystem_signoff_subsystems sg ON sg.id = r.subsystem_id
                         WHERE r.org_id=$1::uuid AND sg.season_year=$2::int
                         GROUP BY 1
                      ) g ON g.k = lower(btrim(s.name))
                WHERE s.org_id=$1::uuid AND s.season_year=$2::int
                ORDER BY s.name ASC
                LIMIT 60`,
              [orgId, seasonYear],
            );
            const checklist = await client.query<{ total: string; done: string }>(
              `SELECT count(*)::text AS total,
                      count(*) FILTER (WHERE is_complete)::text AS done
               FROM readiness_score_checklist_items
               WHERE org_id=$1 AND season_year=$2`,
              [orgId, seasonYear],
            );
            const c = checklist.rows[0];
            return {
              seasonYear,
              subsystems: subsystems.rows,
              checklist: {
                total: Number(c?.total ?? 0) || 0,
                complete: Number(c?.done ?? 0) || 0,
              },
            };
          } catch {
            return { seasonYear, subsystems: [], checklist: { total: 0, complete: 0 }, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "retro.postmortem",
        description:
          "Read this org's auto-compiled season postmortem: counted decisions, risks, safety incidents, and failure-log rows, plus retro action-item follow-through, with a grounded narrative summary.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, narrative, counts, created_at AS "createdAt"
               FROM retro_postmortems
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 1`,
              [orgId, seasonYear],
            );
            return { seasonYear, postmortem: rows.rows[0] ?? null };
          } catch {
            return { seasonYear, postmortem: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "reuse_advisor.assessments",
        description:
          "Read this org's cross-season subsystem reuse assessments for the active design season, including the prior-season failure-log history + design-review-track-record grounded recommendation (reuse, modify, or avoid), confidence, and rationale.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, subsystem_name AS "subsystemName", category,
                      source_season_year AS "sourceSeasonYear",
                      fmea_failure_count AS "fmeaFailureCount",
                      fmea_high_severity_count AS "fmeaHighSeverityCount",
                      design_review_count AS "designReviewCount",
                      design_review_pass_count AS "designReviewPassCount",
                      recommendation, confidence::text AS confidence, rationale, status,
                      updated_at AS "updatedAt"
               FROM reuse_advisor_assessments
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            return { seasonYear, assessments: rows.rows };
          } catch {
            return { seasonYear, assessments: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "rule_impact.assessments",
        description:
          "Read this org's kickoff rule-change log and the resulting still-legal/needs-rework/blocked impact assessments for prior-season subsystems in the active design season, grounded only in logged rule changes matched to the subsystem library.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const assessments = await client.query(
              `SELECT id, subsystem_name AS "subsystemName", category,
                      matched_rule_count AS "matchedRuleCount",
                      blocking_rule_count AS "blockingRuleCount",
                      major_rule_count AS "majorRuleCount",
                      impact_status AS "impactStatus", confidence::text AS confidence,
                      rationale, status, updated_at AS "updatedAt"
               FROM rule_impact_assessments
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 30`,
              [orgId, seasonYear],
            );
            const ruleChanges = await client.query(
              `SELECT id, rule_code AS "ruleCode", title, category, severity,
                      subsystem_category AS "subsystemCategory", summary, source_url AS "sourceUrl"
               FROM rule_impact_rule_changes
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 40`,
              [orgId, seasonYear],
            );
            return { seasonYear, assessments: assessments.rows, ruleChanges: ruleChanges.rows };
          } catch {
            return { seasonYear, assessments: [], ruleChanges: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "season_report.snapshots",
        description:
          "Read this org's generated season retrospective snapshots — narrative sections for build reliability, results, budget, and outreach synthesized only from logged entries, plus highlights, watchouts, and coverage completeness for the season.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, completeness::text AS completeness, narrative, highlights, watchouts,
                      entry_count AS "entryCount", created_at AS "createdAt"
               FROM season_report_snapshots
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC
               LIMIT 10`,
              [orgId, seasonYear],
            );
            return { seasonYear, snapshots: rows.rows };
          } catch {
            return { seasonYear, snapshots: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "sketch_to_brief.draft",
        description:
          "Grounded read of a transcribed kickoff whiteboard sketch fused with the org's own answered kickoff rule notes, open rule questions, design priorities, and scoring actions into a first-pass CAD brief with rule-compliance flags.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT b.id, b.title, b.brief, b.rule_flag_count AS "ruleFlagCount",
                      b.generated_by AS "generatedBy", b.created_at AS "createdAt",
                      s.id AS "sketchId", s.title AS "sketchTitle", s.category, s.notes,
                      s.season_year AS "seasonYear"
               FROM sketch_to_brief_briefs b
               JOIN sketch_to_brief_sketches s ON s.id = b.sketch_id AND s.org_id = b.org_id
               WHERE b.org_id=$1 AND s.season_year=$2
               ORDER BY b.created_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, briefs: rows.rows };
          } catch {
            return { seasonYear, briefs: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "skills_graph.mentor_matches",
        description:
          "Grounded read of declared team skills, completed-task evidence, and ranked mentor matches for open requests.",
        parseInput(value) {
          object(value);
          return {};
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }) {
          try {
            const requests = await client.query(
              `SELECT r.id, r.requester_user_id::text AS "requesterUserId", req.name AS "requesterName",
                      r.skill_category AS "skillCategory", r.note, r.status,
                      r.matched_user_id::text AS "matchedUserId", m.name AS "matchedUserName",
                      r.matched_rationale AS "matchedRationale", r.updated_at AS "updatedAt"
               FROM skills_graph_mentor_requests r
               LEFT JOIN users req ON req.id = r.requester_user_id
               LEFT JOIN users m ON m.id = r.matched_user_id
               WHERE r.org_id=$1
               ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'matched' THEN 1 ELSE 2 END,
                        r.updated_at DESC
               LIMIT 30`,
              [orgId],
            );
            const skills = await client.query(
              `SELECT e.id, e.user_id::text AS "userId", u.name AS "userName",
                      e.skill_category AS "skillCategory", e.custom_label AS "customLabel",
                      e.proficiency, e.evidence_note AS "evidenceNote"
               FROM skills_graph_entries e
               LEFT JOIN users u ON u.id = e.user_id
               WHERE e.org_id=$1
               ORDER BY e.created_at DESC
               LIMIT 60`,
              [orgId],
            );
            return { mentorRequests: requests.rows, skills: skills.rows };
          } catch {
            return { mentorRequests: [], skills: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "spare_robot_kit.checklists",
        description:
          "Read this org's competition spare-parts kit checklists for the active season — candidate items derived from crossing inventory spare bins against failure-log repeat-failure history, with pack priority, recommended quantity, and pack status.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, title, status, items, rationale,
                      created_at AS "createdAt", updated_at AS "updatedAt"
               FROM spare_robot_kit_checklists
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, checklists: rows.rows };
          } catch {
            return { seasonYear, checklists: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "standup_digest.brief",
        description:
          "Read this org's compiled morning standup digest for a given date: logged hours, task movement (completed/blocked/created), open blockers, attendance, and knowledge-page edits, grouped by subteam.",
        parseInput(value) {
          const input = object(value);
          const raw = String(input.digestDate ?? input.date ?? "").trim();
          const digestDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
          return { digestDate };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
          try {
            const rows = await client.query(
              `SELECT id, digest_date AS "digestDate", season_year AS "seasonYear",
                      summary, headline, created_at AS "createdAt"
               FROM standup_digest_runs
               WHERE org_id=$1 AND ($2::date IS NULL OR digest_date=$2::date)
               ORDER BY digest_date DESC
               LIMIT 1`,
              [orgId, input.digestDate],
            );
            return { digest: rows.rows[0] ?? null };
          } catch {
            return { digest: null, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "tuning_autopilot.sessions",
        description:
          "Read this org's logged PID/feedforward tuning sessions for the active season, including each iteration's gain set, observed test result (overshoot, settling time, steady-state error, oscillation), and the deterministic next-gain suggestion derived from that session's own logged trend.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT s.id, s.subsystem, s.controller_type AS "controllerType", s.goal, s.status,
                      s.updated_at AS "updatedAt",
                      coalesce(it.iterations, '[]'::jsonb) AS iterations
               FROM tuning_autopilot_sessions s
               LEFT JOIN LATERAL (
                 SELECT jsonb_agg(jsonb_build_object(
                          'iterationIndex', i.iteration_index,
                          'kP', i.k_p, 'kI', i.k_i, 'kD', i.k_d,
                          'kS', i.k_s, 'kV', i.k_v, 'kG', i.k_g,
                          'overshootPct', i.overshoot_pct,
                          'settlingTimeSec', i.settling_time_sec,
                          'steadyStateError', i.steady_state_error,
                          'oscillating', i.oscillating, 'notes', i.notes
                        ) ORDER BY i.iteration_index) AS iterations
                 FROM tuning_autopilot_iterations i
                 WHERE i.session_id = s.id AND i.org_id = s.org_id
               ) it ON true
               WHERE s.org_id=$1 AND s.season_year=$2
               ORDER BY s.updated_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, sessions: rows.rows };
          } catch {
            return { seasonYear, sessions: [], setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "wiring_diagnoser.checks",
        description:
          "Read this org's wiring-diagram vs board-observation checks for the active season, including flagged miswires, undersized breakers, wire-undersized-for-breaker faults, and over-spec channels with risk score.",
        parseInput: seasonInput,
        parseOutput: objectOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const seasonYear = lockSeasonYear(input.seasonYear, activeEventKey);
          try {
            const rows = await client.query(
              `SELECT id, board_name AS "boardName", expected_circuits AS "expectedCircuits",
                      observed_circuits AS "observedCircuits", flags,
                      risk_score::text AS "riskScore", summary, updated_at AS "updatedAt"
               FROM wiring_diagnoser_checks
               WHERE org_id=$1 AND season_year=$2
               ORDER BY updated_at DESC
               LIMIT 20`,
              [orgId, seasonYear],
            );
            return { seasonYear, checks: rows.rows };
          } catch {
            return { seasonYear, checks: [], setup_required: true };
          }
        },
      }),
    );
}
