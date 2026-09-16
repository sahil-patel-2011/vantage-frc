import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  fundingModelFromFlags,
  isFundingAffiliation,
  parseFundingProfileSave,
  type FundingAffiliation,
  type FundingModel,
  type FundingProfileView,
} from "../../../../lib/funding-profile";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

type FundingRow = {
  teamAffiliation: string | null;
  schoolFunded: boolean | null;
  outsideGrants: boolean | null;
  sponsorsAllowed: boolean | null;
  fundingModel: string | null;
  role: string;
};

/** 42703 undefined_column, 42704 undefined_object (the enum 0651 also adds). */
function isMissingFundingModel(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== "42703" && code !== "42704") return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /funding_model/.test(message);
}

function toView(orgId: string, row: FundingRow, canEdit: boolean): FundingProfileView {
  const teamAffiliation: FundingAffiliation = isFundingAffiliation(row.teamAffiliation)
    ? row.teamAffiliation
    : "community";
  const sponsorsAllowed = row.sponsorsAllowed !== false;
  const schoolFunded = Boolean(row.schoolFunded);
  const fundingModel: FundingModel = (row.fundingModel as FundingModel | null) ??
    fundingModelFromFlags({ schoolFunded, sponsorsAllowed });
  return {
    orgId,
    canEdit,
    teamAffiliation,
    schoolFunded,
    outsideGrants: Boolean(row.outsideGrants),
    sponsorsAllowed,
    fundingModel,
  };
}

export async function GET(request: Request) {
  try {
    const user = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");

    const view = await withRls({ userId: user.user.id, orgId }, async (client) => {
      const result = await client.query<FundingRow>(
        // funding_model is read through to_jsonb for the same reason Home is
        // (see lib/dashboard/snapshot.ts): on a deployment that has not run
        // 0651 the column raises 42703 and the whole profile fails, where
        // NULL just falls back to the school_funded / sponsors_allowed flags.
        `SELECT o.team_affiliation AS "teamAffiliation",
                o.school_funded AS "schoolFunded",
                o.outside_grants AS "outsideGrants",
                o.sponsors_allowed AS "sponsorsAllowed",
                to_jsonb(o) ->> 'funding_model' AS "fundingModel",
                m.role
         FROM organizations o
         JOIN memberships m ON m.org_id = o.id AND m.user_id = $2::uuid
         WHERE o.id = $1::uuid`,
        [orgId, user.user.id],
      );
      if (!result.rowCount) throw new Error("Organization access denied");
      const row = result.rows[0]!;
      const canEdit = row.role === "owner" || row.role === "admin";
      return toView(orgId, row, canEdit);
    });

    return Response.json(view);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Funding profile unavailable" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!orgId) throw new Error("orgId is required");
    const payload = parseFundingProfileSave(body);

    await withRls({ userId: user.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_team_settings");
      try {
        await client.query(
          `UPDATE organizations
           SET team_affiliation = $2,
               school_funded = $3,
               outside_grants = $4,
               sponsors_allowed = $5,
               funding_model = $6::org_funding_model
           WHERE id = $1::uuid`,
          [
            orgId,
            payload.teamAffiliation,
            payload.schoolFunded,
            payload.outsideGrants,
            payload.sponsorsAllowed,
            payload.fundingModel,
          ],
        );
      } catch (error) {
        // Reading tolerates the missing column; writing cannot. Name the
        // migration instead of surfacing raw 42703 / 42704 to a mentor.
        if (isMissingFundingModel(error)) {
          throw new Error("Saving how the team is funded requires migration 0651_funding_model", {
            cause: error,
          });
        }
        throw error;
      }
      await client.query(
        `INSERT INTO auth_policy_audit_events(org_id, actor_user_id, action, metadata)
         VALUES ($1::uuid, $2::uuid, 'org.funding_profile.updated', $3::jsonb)`,
        [
          orgId,
          user.user.id,
          JSON.stringify({
            teamAffiliation: payload.teamAffiliation,
            schoolFunded: payload.schoolFunded,
            outsideGrants: payload.outsideGrants,
            sponsorsAllowed: payload.sponsorsAllowed,
            fundingModel: payload.fundingModel,
          }),
        ],
      );
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Funding profile update failed" },
      { status: 400 },
    );
  }
}
