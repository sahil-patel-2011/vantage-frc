import { AIToolRegistry, type ToolDefinition } from "./orchestrator";

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
          "Read organization-scoped match + pit scouting observations (with entry ids for provenance)",
        parseInput: teamInput,
        parseOutput: rowsOutput,
        async execute({ client, orgId, activeEventKey }, input) {
          return (
            await client.query(
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
        },
      }),
    )
    .register(
      tool({
        name: "strategy.match",
        description:
          "Read stored match prediction + strategy plan including scout provenance and operational signals",
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
          return {
            prediction: prediction.rows[0] ?? null,
            strategy: plan.rows[0] ?? null,
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
    );
}
