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
        `SELECT o.team_affiliation AS "teamAffiliation",
                o.school_funded AS "schoolFunded",
                o.outside_grants AS "outsideGrants",
                o.sponsors_allowed AS "sponsorsAllowed",
                o.funding_model AS "fundingModel",
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
