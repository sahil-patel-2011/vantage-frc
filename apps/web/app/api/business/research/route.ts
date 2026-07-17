import { createSearchProvider, type SearchResult } from "@vantage/intel-research";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { rankSponsorFit } from "../../../../lib/business-portal";

function cleanName(result: SearchResult): string {
  const title = result.title.split(/\s+[|–—-]\s+/)[0]?.trim();
  if (title && title.length >= 2 && title.length <= 160) return title;
  try {
    return new URL(result.url).hostname.replace(/^www\./, "").split(".")[0]!.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "Sponsor prospect";
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: { orgId?: string };
  try {
    body = (await request.json()) as { orgId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const context = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const org = await client.query<{ orgName: string; teamNumber: number | null }>(
        `SELECT o.name AS "orgName", o.team_number AS "teamNumber"
         FROM organizations o JOIN memberships m ON m.org_id = o.id
         WHERE o.id = $1 AND m.user_id = $2 LIMIT 1`,
        [body.orgId, session.user.id],
      );
      if (!org.rows[0]) throw new Error("Organization access denied");
      const sponsors = await client.query<{ name: string; industry: string | null; website: string | null }>(
        `SELECT name, industry, website FROM sponsors WHERE org_id = $1`,
        [body.orgId],
      );
      return { ...org.rows[0], sponsors: sponsors.rows };
    });

    const industries = [...new Set(context.sponsors.map((sponsor) => sponsor.industry).filter((value): value is string => Boolean(value)))];
    const teamLabel = context.teamNumber ? `FRC Team ${context.teamNumber}` : context.orgName;
    const queries = [
      `${teamLabel} robotics team corporate sponsors community partners`,
      `${teamLabel} youth STEM education grants robotics sponsorship`,
      `${industries.slice(0, 3).join(" ")} engineering manufacturing companies youth robotics community sponsorship`,
    ];
    const provider = createSearchProvider();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let found: Array<SearchResult & { query: string }> = [];
    try {
      const batches = await Promise.all(queries.map(async (query) =>
        (await provider.search(query, { limit: 6, signal: controller.signal })).map((result) => ({ ...result, query })),
      ));
      found = batches.flat();
    } finally {
      clearTimeout(timeout);
    }

    const existingNames = new Set(context.sponsors.map((sponsor) => sponsor.name.toLowerCase()));
    const existingHosts = new Set(context.sponsors.flatMap((sponsor) => {
      try { return sponsor.website ? [new URL(sponsor.website).hostname.replace(/^www\./, "")] : []; } catch { return []; }
    }));
    const candidates = new Map<string, {
      name: string; website: string; summary: string; sourceTitle: string; sourceQuery: string; fitScore: number; fitReason: string;
    }>();
    for (const result of found) {
      let url: URL;
      try {
        url = new URL(result.url);
        if (!['http:', 'https:'].includes(url.protocol)) continue;
      } catch {
        continue;
      }
      const host = url.hostname.replace(/^www\./, "");
      const name = cleanName(result);
      if (existingNames.has(name.toLowerCase()) || existingHosts.has(host) || candidates.has(host)) continue;
      const fit = rankSponsorFit({ text: `${result.title} ${result.snippet}`, industries, teamNumber: context.teamNumber });
      candidates.set(host, {
        name,
        website: url.toString(),
        summary: result.snippet.slice(0, 2_000) || "Review the linked source to confirm sponsorship fit.",
        sourceTitle: result.title.slice(0, 300),
        sourceQuery: result.query,
        fitScore: fit.score,
        fitReason: fit.reason,
      });
    }

    const inserted = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      let count = 0;
      for (const prospect of [...candidates.values()].sort((a, b) => b.fitScore - a.fitScore).slice(0, 12)) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM sponsor_prospects WHERE org_id = $1 AND website = $2 LIMIT 1`,
          [body.orgId, prospect.website],
        );
        const result = existing.rows[0]
          ? await client.query(
              `UPDATE sponsor_prospects SET company_name = $3, rationale = $4,
                 source_urls = $5::jsonb, source_query = $6, fit_score = $7, suggested_by = $8
               WHERE id = $1 AND org_id = $2 RETURNING id`,
              [existing.rows[0].id, body.orgId, prospect.name, `${prospect.fitReason}. ${prospect.summary}`, JSON.stringify([prospect.website]), prospect.sourceQuery, prospect.fitScore, provider.name],
            )
          : await client.query(
              `INSERT INTO sponsor_prospects(
                 org_id, company_name, website, rationale, source_urls, source_query, fit_score, suggested_by
               ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
              [body.orgId, prospect.name, prospect.website, `${prospect.fitReason}. ${prospect.summary}`, JSON.stringify([prospect.website]), prospect.sourceQuery, prospect.fitScore, provider.name],
            );
        if (result.rowCount) count += 1;
      }
      await client.query(
        `INSERT INTO team_business_audit_events(org_id, actor_user_id, action, entity_type, metadata)
         VALUES ($1,$2,'research-sponsors','sponsor_prospect',$3::jsonb)`,
        [body.orgId, session.user.id, JSON.stringify({ provider: provider.name, queries, resultCount: count })],
      );
      return count;
    });

    return Response.json({
      provider: provider.name,
      count: inserted,
      message: inserted
        ? `Found ${inserted} source-linked prospect${inserted === 1 ? "" : "s"}. Review each before adding it to the relationship pipeline.`
        : provider.name === "local-fixture"
          ? "No live research connector is configured. Add RESEARCH_SEARCH_ENDPOINT and RESEARCH_SEARCH_API_KEY to enable source-linked sponsor discovery."
          : "No new sponsor prospects were found. Try again after adding more sponsor industries or team history.",
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Sponsor research timed out. Please try again."
      : error instanceof Error ? error.message : "Sponsor research failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
