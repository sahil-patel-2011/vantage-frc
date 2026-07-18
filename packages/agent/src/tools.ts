import { AIToolRegistry, type ToolDefinition } from "./orchestrator";
import { checkGameRuleCompliance } from "./rule-compliance";
import { FINANCE_IN_AI_DENIED, sanitizeFinancePayloadForAi } from "./finance-redact";
import { isFinanceInAiAllowed, loadOrgAiPolicy } from "@vantage/billing";

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
    return { seasonYear: new Date().getUTCFullYear() };
  }
  const seasonYear = Number(raw);
  if (!Number.isInteger(seasonYear) || seasonYear < 1992 || seasonYear > 2100) {
    throw new Error("seasonYear must be a whole number between 1992 and 2100");
  }
  return { seasonYear };
};
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
  "scouting.team",
  "reference.team",
  "fmea.open_risks",
  "fmea.repeat",
  "cad.briefs",
  "cad.create_brief",
  "knowledge.search",
  "finance.summary",
  "finance.orders",
  "finance.create_purchase_request",
] as const;

export const ORG_DATA_TOOLS = [
  "scouting.team",
  "strategy.match",
  "strategy.design",
  "artifacts.related",
  "kickoff.intelligence",
  "kickoff.rules",
  "rules.compliance",
  "cad.briefs",
  "cad.create_brief",
  "knowledge.search",
  "knowledge.get_page",
  "fmea.open_risks",
  "fmea.repeat",
  "finance.summary",
  "finance.orders",
  "finance.create_purchase_request",
] as const;

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
  let headline = `${open.length} open request${open.length === 1 ? "" : "s"} totaling ${usdLabel(openTotalUsd)}.`;
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

export function createVantageToolRegistry() {
  return new AIToolRegistry()
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
          "Read organization-scoped match + pit scouting with TBA trust provenance. Contradicted climb/mobility/foul fields are stripped from trustedPayload — never treat them as facts.",
        parseInput: teamInput,
        parseOutput: rowsOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          const entries = (
            await client.query<{
              id: string;
              entryType: string;
              teamKey: string;
              matchKey: string | null;
              payload: Record<string, unknown>;
              confidence: string | null;
              scoutUserId: string | null;
              updatedAt: string;
            }>(
              `SELECT * FROM (
                 SELECT id, 'match' AS "entryType", team_key AS "teamKey", match_key AS "matchKey",
                        payload, confidence, scout_user_id::text AS "scoutUserId",
                        updated_at AS "updatedAt"
                 FROM match_scout_entries
                 WHERE org_id=$1 AND event_key=$2 AND team_key=$3
                 UNION ALL
                 SELECT id, 'pit' AS "entryType", team_key AS "teamKey", NULL::text AS "matchKey",
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
            const trustedPayload: Record<string, unknown> = {};
            const excludedFields: string[] = [];
            for (const [key, value] of Object.entries(entry.payload ?? {})) {
              if (conflictKeys.has(key)) {
                excludedFields.push(key);
                continue;
              }
              trustedPayload[key] = value;
            }
            return {
              id: entry.id,
              entryType: entry.entryType,
              teamKey: entry.teamKey,
              matchKey: entry.matchKey,
              /** Raw scout payload — may include TBA-contradicted fields; prefer trustedPayload. */
              payload: entry.payload,
              trustedPayload,
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
            };
          });
        },
      }),
    )
    .register(
      tool({
        name: "strategy.match",
        description:
          "Read stored match prediction + strategy plan, scout provenance, and TBA scout conflicts for alliance teams",
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
                ? "Scout fields listed in scoutTbaConflicts contradicted TBA official results — do not trust those values."
                : "No TBA-contradicted scout fields recorded for alliance teams.",
          };
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
        async execute({ client, orgId }, input) {
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
              [orgId, input.seasonYear],
            );
            return { seasonYear: input.seasonYear, record: row.rows[0] ?? null };
          } catch {
            return { seasonYear: input.seasonYear, record: null, setup_required: true };
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
        async execute({ client, orgId }, input) {
          const notes = await client.query(
            `SELECT id, question, answer, rule_ref AS "ruleRef", status
             FROM kickoff_rule_notes
             WHERE org_id=$1 AND season_year=$2
             ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
             LIMIT 40`,
            [orgId, input.seasonYear],
          );
          let constraints: string[] = [];
          try {
            const intel = await client.query<{ summary: { constraints?: string[] } | null }>(
              `SELECT summary FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC LIMIT 1`,
              [orgId, input.seasonYear],
            );
            if (Array.isArray(intel.rows[0]?.summary?.constraints)) {
              constraints = intel.rows[0]!.summary!.constraints!;
            }
          } catch {
            // kickoff_game_intelligence not migrated yet
          }
          return {
            seasonYear: input.seasonYear,
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
        async execute({ client, orgId }, input) {
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
            [orgId, input.seasonYear],
          );
          let constraints: string[] = [];
          try {
            const intel = await client.query<{ summary: { constraints?: string[] } | null }>(
              `SELECT summary FROM kickoff_game_intelligence
               WHERE org_id=$1 AND season_year=$2
               ORDER BY created_at DESC LIMIT 1`,
              [orgId, input.seasonYear],
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
            seasonYear: input.seasonYear,
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
        async execute({ client, orgId }, input) {
          const priorities = await client.query(
            `SELECT id, capability, rationale, weight, status,
                    linked_action_id AS "linkedActionId"
             FROM design_priorities
             WHERE org_id=$1 AND season_year=$2
             ORDER BY weight DESC, created_at ASC
             LIMIT 40`,
            [orgId, input.seasonYear],
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
              [orgId, input.seasonYear],
            );
            kickoffStrategy = (intel.rows[0] as Record<string, unknown> | undefined) ?? null;
          } catch {
            // optional
          }
          return {
            seasonYear: input.seasonYear,
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
        name: "fmea.repeat",
        description:
          "Detect subsystems that failed repeatedly this season (FMEA log, with pit robot_failures fallback). Returns empty when nothing repeats — never invents counts.",
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
        async execute({ client, orgId }, input) {
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
              [orgId, input.seasonYear, input.threshold, input.limit],
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
                  message: `${row.subsystemName} has failed ${failureCount} time${failureCount === 1 ? "" : "s"} this season (${input.seasonYear})`,
                  recentTitles: Array.isArray(row.titles) ? row.titles.filter(Boolean) : [],
                  href: "/fmea",
                  source: "fmea_failures",
                };
              });
              return { seasonYear: input.seasonYear, threshold: input.threshold, alerts };
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
              [orgId, input.seasonYear, input.threshold, input.limit],
            );
            const alerts = pit.rows.map((row) => {
              const failureCount = Number(row.failureCount) || 0;
              return {
                subsystemName: row.subsystemName,
                subsystemId: null,
                failureCount,
                openCount: failureCount,
                maxRpn: null,
                message: `${row.subsystemName} has failed ${failureCount} time${failureCount === 1 ? "" : "s"} this season (${input.seasonYear})`,
                recentTitles: Array.isArray(row.titles) ? row.titles.filter(Boolean) : [],
                href: "/pit",
                source: "robot_failures",
              };
            });
            return { seasonYear: input.seasonYear, threshold: input.threshold, alerts };
          } catch {
            return { seasonYear: input.seasonYear, threshold: input.threshold, alerts: [], setup_required: true };
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
          "Read open / fixing FMEA failures ranked by RPN — CAD and strategy treat these as real reliability risks",
        parseInput(value) {
          const season = seasonInput(value);
          const input = object(value);
          const limitRaw = Number(input.limit ?? 12);
          const limit = Number.isFinite(limitRaw) ? Math.min(30, Math.max(1, Math.floor(limitRaw))) : 12;
          return { seasonYear: season.seasonYear, limit };
        },
        parseOutput: objectOutput,
        async execute({ client, orgId }, input) {
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
              [orgId, input.seasonYear, input.limit],
            );
            return { seasonYear: input.seasonYear, failures: rows.rows, openCount: rows.rows.length };
          } catch {
            return { seasonYear: input.seasonYear, failures: [], openCount: 0, setup_required: true };
          }
        },
      }),
    )
    .register(
      tool({
        name: "cad.create_brief",
        description:
          "Create a metered CAD engineering brief grounded in strategy.match, kickoff design priorities, FMEA risks, and knowledge (shared tool graph — no copy-paste)",
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
        async execute({ client, orgId, userId }, input) {
          const { createMeteredCadBriefJob } = await import("./cad-brief");
          try {
            const created = await createMeteredCadBriefJob(client, {
              orgId,
              userId,
              title: input.title,
              request: input.request,
              seasonYear: input.seasonYear,
              selected: input.matchKey ? { matchKey: input.matchKey } : undefined,
              sources: [],
            });
            return {
              jobId: created.jobId,
              status: created.status,
              aiRunId: created.aiRunId,
              title: input.title,
              summary: created.brief.summary,
              requirementCount: created.brief.requirements.length,
              riskCount: created.brief.risks.length,
              tools: created.tools.map((t) => ({ name: t.name, status: t.status, summary: t.summary })),
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
    );
}
