import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { buildTextPdf } from "@vantage/export-center";
import { headers } from "next/headers";
import {
  buildOnePagerLines,
  buildWhoWeAreSeed,
  currentSeasonYear,
  defaultTitle,
  evaluateCompleteness,
  parseCreateOnePager,
  parseUpdateOnePager,
  type OnePagerStatus,
  type SponsorshipContext,
  type SponsorshipOnePager,
  type SponsorshipView,
} from "../../../lib/sponsorship-value-prop";
import { coerceAchievementList } from "../../../lib/team-background";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Sponsorship request failed" }, { status });
}

function seasonFrom(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

type OrgRow = {
  orgId: string;
  orgName: string | null;
  teamNumber: number | null;
  role: string;
  city: string | null;
  stateProv: string | null;
  description: string | null;
};

async function resolveOrg(client: PoolClient, userId: string, requestedOrg: string | null): Promise<OrgRow | null> {
  const membership = await client.query<OrgRow>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
            o.city, o.state_prov AS "stateProv", o.description
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

async function loadSeed(
  client: PoolClient,
  org: OrgRow,
  seasonYear: number,
): Promise<{ seedWhoWeAre: string | null; seedFundingNeed: string | null }> {
  // THIS org only — team background + onboarding location/description, then writer_profile.
  const [background, writer] = await Promise.all([
    client.query<{
      mission: string | null;
      history: string | null;
      demographics: string | null;
      achievements: unknown;
      studentCount: number | null;
      mentorCount: number | null;
      foundedYear: number | null;
    }>(
      `SELECT mission, history, demographics, achievements,
              student_count AS "studentCount",
              mentor_count AS "mentorCount",
              founded_year AS "foundedYear"
       FROM team_background_profile
       WHERE org_id = $1::uuid`,
      [org.orgId],
    ),
    client.query<{ mission: string | null; fundingNeed: string | null }>(
      `SELECT mission, funding_need AS "fundingNeed"
       FROM writer_profile
       WHERE org_id = $1::uuid AND season_year = $2
       LIMIT 1`,
      [org.orgId, seasonYear],
    ),
  ]);

  const bg = background.rows[0];
  const writerRow = writer.rows[0];
  const seedWhoWeAre =
    buildWhoWeAreSeed(
      {
        city: org.city,
        stateProv: org.stateProv,
        description: org.description,
        orgName: org.orgName,
        teamNumber: org.teamNumber,
      },
      {
        mission: bg?.mission ?? writerRow?.mission ?? null,
        history: bg?.history ?? null,
        demographics: bg?.demographics ?? null,
        achievements: coerceAchievementList(bg?.achievements),
        studentCount: bg?.studentCount ?? null,
        mentorCount: bg?.mentorCount ?? null,
        foundedYear: bg?.foundedYear ?? null,
      },
    ) ??
    writerRow?.mission ??
    null;

  return { seedWhoWeAre, seedFundingNeed: writerRow?.fundingNeed ?? null };
}

type PageRow = {
  id: string;
  title: string;
  seasonYear: number;
  whoWeAre: string;
  whatWeDo: string;
  askCashUsd: string | number | null;
  askParts: string;
  askMentorship: string;
  sponsorGets: string;
  inviteEnabled: boolean;
  inviteDetails: string;
  status: OnePagerStatus;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapPage(row: PageRow): SponsorshipOnePager {
  const ask = row.askCashUsd == null || row.askCashUsd === "" ? null : Number(row.askCashUsd);
  return {
    id: row.id,
    title: row.title,
    seasonYear: row.seasonYear,
    whoWeAre: row.whoWeAre,
    whatWeDo: row.whatWeDo,
    askCashUsd: ask != null && Number.isFinite(ask) ? ask : null,
    askParts: row.askParts,
    askMentorship: row.askMentorship,
    sponsorGets: row.sponsorGets,
    inviteEnabled: row.inviteEnabled,
    inviteDetails: row.inviteDetails,
    status: row.status,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listPages(client: PoolClient, orgId: string, seasonYear: number): Promise<SponsorshipOnePager[]> {
  const result = await client.query<PageRow>(
    `SELECT p.id, p.title, p.season_year AS "seasonYear",
            p.who_we_are AS "whoWeAre", p.what_we_do AS "whatWeDo",
            p.ask_cash_usd AS "askCashUsd", p.ask_parts AS "askParts",
            p.ask_mentorship AS "askMentorship", p.sponsor_gets AS "sponsorGets",
            p.invite_enabled AS "inviteEnabled", p.invite_details AS "inviteDetails",
            p.status, u.name AS "createdByName",
            p.created_at::text AS "createdAt", p.updated_at::text AS "updatedAt"
     FROM sponsorship_value_props p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.org_id = $1::uuid AND p.season_year = $2
     ORDER BY p.updated_at DESC`,
    [orgId, seasonYear],
  );
  return result.rows.map(mapPage);
}

async function listSeasons(client: PoolClient, orgId: string): Promise<number[]> {
  const result = await client.query<{ seasonYear: number }>(
    `SELECT DISTINCT season_year AS "seasonYear"
     FROM sponsorship_value_props
     WHERE org_id = $1::uuid
     ORDER BY season_year DESC`,
    [orgId],
  );
  return result.rows.map((row) => row.seasonYear);
}

async function buildView(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
  seasonYear: number,
): Promise<SponsorshipView> {
  const org = await resolveOrg(client, userId, requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      seasonYear,
      message: "Choose your team to compose sponsorship one-pagers.",
      context: {
        orgId: null,
        orgName: null,
        teamNumber: null,
        role: null,
        seedWhoWeAre: null,
        seedFundingNeed: null,
      },
    };
  }

  const [seed, onePagers, seasons] = await Promise.all([
    loadSeed(client, org, seasonYear),
    listPages(client, org.orgId, seasonYear),
    listSeasons(client, org.orgId),
  ]);

  const context: SponsorshipContext = {
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    role: org.role,
    seedWhoWeAre: seed.seedWhoWeAre,
    seedFundingNeed: seed.seedFundingNeed,
  };

  return {
    status: "ready",
    context,
    seasonYear,
    seasons: seasons.includes(seasonYear) ? seasons : [seasonYear, ...seasons],
    onePagers,
  };
}

async function requirePageInOrg(client: PoolClient, orgId: string, id: string): Promise<SponsorshipOnePager> {
  const result = await client.query<PageRow>(
    `SELECT p.id, p.title, p.season_year AS "seasonYear",
            p.who_we_are AS "whoWeAre", p.what_we_do AS "whatWeDo",
            p.ask_cash_usd AS "askCashUsd", p.ask_parts AS "askParts",
            p.ask_mentorship AS "askMentorship", p.sponsor_gets AS "sponsorGets",
            p.invite_enabled AS "inviteEnabled", p.invite_details AS "inviteDetails",
            p.status, u.name AS "createdByName",
            p.created_at::text AS "createdAt", p.updated_at::text AS "updatedAt"
     FROM sponsorship_value_props p
     LEFT JOIN users u ON u.id = p.created_by
     WHERE p.org_id = $1::uuid AND p.id = $2::uuid
     LIMIT 1`,
    [orgId, id],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "One-pager not found on this team");
  return mapPage(row);
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = seasonFrom(url.searchParams.get("season"));

    const view = await withRls({ userId: session.user.id }, (client) =>
      buildView(client, session.user.id, requestedOrg, seasonYear),
    );
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }

    const orgId = typeof body.orgId === "string" ? body.orgId : null;
    if (!orgId) throw new HttpError(400, "orgId is required");
    const action = String(body.action ?? "");
    const seasonYear = seasonFrom(
      typeof body.seasonYear === "string" || typeof body.seasonYear === "number" ? String(body.seasonYear) : null,
    );

    if (action === "pdf") {
      const id = String(body.id ?? "");
      if (!id) throw new HttpError(400, "id is required");
      const pdf = await withRls({ userId: session.user.id, orgId }, async (client) => {
        const org = await resolveOrg(client, session.user.id, orgId);
        if (!org || org.orgId !== orgId) throw new HttpError(403, "Organization membership required");
        const page = await requirePageInOrg(client, orgId, id);
        const lines = buildOnePagerLines(page, {
          orgName: org.orgName,
          teamNumber: org.teamNumber,
        });
        return buildTextPdf({
          title: page.title,
          subtitle: `${org.teamNumber != null ? `FRC ${org.teamNumber} · ` : ""}Season ${page.seasonYear} · This team only`,
          lines,
          footer: "Vantage sponsorship one-pager · org-isolated",
        });
      });
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="vantage-sponsorship-one-pager.pdf"',
        },
      });
    }

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const org = await resolveOrg(client, session.user.id, orgId);
      if (!org || org.orgId !== orgId) throw new HttpError(403, "Organization membership required");

      if (action === "create") {
        const input = parseCreateOnePager(body, seasonYear);
        const seed = await loadSeed(client, org, input.seasonYear);
        const whoWeAre = input.whoWeAre || seed.seedWhoWeAre || "";
        await client.query(
          `INSERT INTO sponsorship_value_props(
             org_id, season_year, title, who_we_are, what_we_do,
             ask_cash_usd, ask_parts, ask_mentorship, sponsor_gets,
             invite_enabled, invite_details, created_by
           ) VALUES (
             $1::uuid, $2, $3, $4, $5,
             $6, $7, $8, $9,
             $10, $11, $12::uuid
           )`,
          [
            org.orgId,
            input.seasonYear,
            input.title || defaultTitle(org.teamNumber, input.seasonYear),
            whoWeAre,
            input.whatWeDo || seed.seedFundingNeed || "",
            input.askCashUsd,
            input.askParts,
            input.askMentorship,
            input.sponsorGets,
            input.inviteEnabled,
            input.inviteDetails,
            session.user.id,
          ],
        );
        return buildView(client, session.user.id, org.orgId, input.seasonYear);
      }

      if (action === "update") {
        const patch = parseUpdateOnePager(body);
        const existing = await requirePageInOrg(client, org.orgId, patch.id);

        const next = {
          title: patch.title ?? existing.title,
          whoWeAre: patch.whoWeAre ?? existing.whoWeAre,
          whatWeDo: patch.whatWeDo ?? existing.whatWeDo,
          askCashUsd: patch.askCashUsd !== undefined ? patch.askCashUsd : existing.askCashUsd,
          askParts: patch.askParts ?? existing.askParts,
          askMentorship: patch.askMentorship ?? existing.askMentorship,
          sponsorGets: patch.sponsorGets ?? existing.sponsorGets,
          inviteEnabled: patch.inviteEnabled ?? existing.inviteEnabled,
          inviteDetails: patch.inviteDetails ?? existing.inviteDetails,
          status: patch.status ?? existing.status,
        };

        if (next.status === "ready") {
          const completeness = evaluateCompleteness(next);
          if (!completeness.complete) {
            throw new HttpError(400, `One-pager is incomplete: ${completeness.missing.join(", ")}`);
          }
        }

        await client.query(
          `UPDATE sponsorship_value_props SET
             title = $3,
             who_we_are = $4,
             what_we_do = $5,
             ask_cash_usd = $6,
             ask_parts = $7,
             ask_mentorship = $8,
             sponsor_gets = $9,
             invite_enabled = $10,
             invite_details = $11,
             status = $12,
             updated_at = now()
           WHERE org_id = $1::uuid AND id = $2::uuid`,
          [
            org.orgId,
            patch.id,
            next.title,
            next.whoWeAre,
            next.whatWeDo,
            next.askCashUsd,
            next.askParts,
            next.askMentorship,
            next.sponsorGets,
            next.inviteEnabled,
            next.inviteEnabled ? next.inviteDetails : "",
            next.status,
          ],
        );
        return buildView(client, session.user.id, org.orgId, existing.seasonYear);
      }

      if (action === "delete") {
        const id = String(body.id ?? "");
        if (!id) throw new HttpError(400, "id is required");
        const existing = await requirePageInOrg(client, org.orgId, id);
        const deleted = await client.query(
          `DELETE FROM sponsorship_value_props
           WHERE org_id = $1::uuid AND id = $2::uuid
             AND (
               created_by = $3::uuid
               OR EXISTS (
                 SELECT 1 FROM memberships m
                 WHERE m.org_id = $1::uuid AND m.user_id = $3::uuid
                   AND m.role IN ('owner', 'admin')
               )
             )
           RETURNING id`,
          [org.orgId, id, session.user.id],
        );
        if (!deleted.rowCount) throw new HttpError(403, "Only the author or an admin can delete this one-pager");
        return buildView(client, session.user.id, org.orgId, existing.seasonYear);
      }

      throw new HttpError(400, "Unknown action");
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
