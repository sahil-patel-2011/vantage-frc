import { createHash } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { AIOrchestrator,type ChatAdapter } from "@vantage/agent";
import type { WebSearchProvider } from "./types";

export type CrawlBudget = {
  maxTeams: number;
  maxQueriesPerTeam: number;
  maxResultsPerQuery: number;
};

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
export const DEFAULT_CRAWL_BUDGET: CrawlBudget = {
  maxTeams: positive(process.env.RESEARCH_MAX_TEAMS, 60),
  maxQueriesPerTeam: positive(process.env.RESEARCH_MAX_QUERIES_PER_TEAM, 2),
  maxResultsPerQuery: positive(process.env.RESEARCH_MAX_RESULTS_PER_QUERY, 5),
};

export function canonicalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["fbclid", "gclid", "ref"].includes(key))
      url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function sourceTypeFor(url: string, supplied?: string) {
  if (supplied) return supplied;
  const host = new URL(url).hostname;
  if (host.includes("chiefdelphi")) return "cd_post";
  if (host.includes("youtube") || host.includes("youtu.be")) return "reveal_video";
  if (/instagram|facebook|x\.com|twitter|tiktok/.test(host)) return "social";
  return "other";
}

export async function scheduleActiveEventSweep(
  client: PoolClient,
  now = new Date(),
  budget = DEFAULT_CRAWL_BUDGET,
) {
  const year = now.getUTCFullYear();
  const window = await client.query(
    `SELECT 1 FROM season_windows
     WHERE year=$1 AND is_active=true AND $2::date BETWEEN search_start_date AND search_end_date`,
    [year, now.toISOString().slice(0, 10)],
  );
  if (!window.rowCount) return { scheduled: 0, reason: "season_inactive" as const };
  const teams = await client.query<{ teamKey: string; eventKey: string }>(
    `SELECT DISTINCT team_key AS "teamKey", c.active_event_key AS "eventKey"
     FROM org_active_context c
     JOIN matches_ref m ON m.event_key=c.active_event_key
     CROSS JOIN LATERAL jsonb_array_elements_text(
       (m.red_alliance->'teamKeys') || (m.blue_alliance->'teamKeys')
     ) AS team_key
     WHERE c.active_event_key IS NOT NULL
     LIMIT $1`,
    [budget.maxTeams],
  );
  let scheduled = 0;
  for (const team of teams.rows) {
    const insert = await client.query(
      `INSERT INTO research_jobs(team_key,event_key,trigger,status)
       SELECT $1,$2,'scheduled','queued'
       WHERE NOT EXISTS (
         SELECT 1 FROM research_jobs WHERE team_key=$1 AND trigger='scheduled'
           AND created_at > now()-interval '20 hours'
       )`,
      [team.teamKey, team.eventKey],
    );
    scheduled += insert.rowCount ?? 0;
  }
  return { scheduled, reason: "active" as const };
}

export async function runResearchJob(
  client: PoolClient,
  jobId: string,
  provider: WebSearchProvider,
  budget = DEFAULT_CRAWL_BUDGET,
) {
  const claimed = await client.query<{
    teamKey: string;
    teamNumber: number;
    nickname: string | null;
  }>(
    `UPDATE research_jobs j SET status='running',started_at=now(),updated_at=now()
     FROM teams_ref t WHERE j.id=$1 AND j.team_key=t.team_key AND j.status='queued'
     RETURNING j.team_key AS "teamKey",t.team_number AS "teamNumber",t.nickname`,
    [jobId],
  );
  const job = claimed.rows[0];
  if (!job) throw new Error("Research job is not queued");
  const queries = [
    `FRC team ${job.teamNumber} ${job.nickname ?? ""} robot`,
    `team ${job.teamNumber} reveal competition`,
  ].slice(0, budget.maxQueriesPerTeam);
  let resultCount = 0;
  try {
    for (const query of queries) {
      const results = await provider.search(query, { limit: budget.maxResultsPerQuery });
      for (const result of results) {
        const canonicalUrl = canonicalizeUrl(result.url);
        const summary = result.snippet.trim();
        if (!summary) continue;
        const hash = createHash("sha256").update(summary).digest("hex");
        const insert = await client.query(
          `INSERT INTO research_findings(
             team_key,source_url,canonical_url,source_type,source_title,summary,
             confidence,extracted_facts,content_hash,published_at,research_job_id
           ) VALUES($1,$2,$3,$4,$5,$6,0.55,'[]',$7,$8,$9)
           ON CONFLICT(team_key,canonical_url,content_hash) DO NOTHING`,
          [
            job.teamKey,
            result.url,
            canonicalUrl,
            sourceTypeFor(result.url, result.sourceType),
            result.title,
            summary,
            hash,
            result.publishedAt ?? null,
            jobId,
          ],
        );
        resultCount += insert.rowCount ?? 0;
      }
    }
    await client.query(
      `UPDATE research_jobs SET status='completed',completed_at=now(),
       search_queries=$2,result_count=$3,updated_at=now() WHERE id=$1`,
      [jobId, queries.length, resultCount],
    );
    return { queries: queries.length, resultCount };
  } catch (error) {
    await client.query(
      `UPDATE research_jobs SET status='failed',completed_at=now(),error=$2,updated_at=now()
       WHERE id=$1`,
      [jobId, error instanceof Error ? error.message.slice(0, 500) : "Research failed"],
    );
    throw error;
  }
}

export async function runMeteredOnDemandResearch(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  jobId: string;
  requestId: string;
  provider: WebSearchProvider;
  budget?: CrawlBudget;
}) {
  const adapter:ChatAdapter={provider:input.provider.name,model:input.provider.name,complete:async()=>{
      const value = await runResearchJob(
        input.client,
        input.jobId,
        input.provider,
        input.budget,
      );
      return {
        text:JSON.stringify(value),
        promptTokens: value.queries * 30,
        completionTokens: value.resultCount * 20,
        costUsd: 0,
      };
  }};
  const result=await new AIOrchestrator(input.client).run({orgId:input.orgId,userId:input.userId,requestId:input.requestId,capability:"research",privacyScope:"team",message:"Run the authorized on-demand research job and persist source-cited qualitative findings.",adapter,contextSources:[{type:"task",id:input.jobId,content:JSON.stringify({jobId:input.jobId,budget:input.budget??DEFAULT_CRAWL_BUDGET}),importance:1,classification:"model_inference"}]});
  return JSON.parse(result.text) as {queries:number;resultCount:number};
}
