import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeGrantEligibilityView } from "./compute-grant-eligibility-matcher";
import { evaluateGrantEligibility } from ".";
import type { CatalogGrant, TeamEligibilityProfile } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("evaluateGrantEligibility", () => {
  const baseProfile: TeamEligibilityProfile = {
    orgId: ORG,
    teamNumber: 254,
    rookieYear: 2024,
    region: "CA",
    country: "USA",
    studentCount: 20,
    mentorCount: 4,
    hasDemographicsFocus: true,
    mentorEmployers: ["Boeing Company"],
    missingFields: [],
  };

  const grant: CatalogGrant = {
    id: GRANT_ID,
    name: "Boeing Rookie Grant",
    funder: "Boeing",
    description: null,
    amountMin: 1000,
    amountMax: 5000,
    applicationUrl: null,
    eligibilityRules: { maxRookieYears: 3, mentorEmployers: ["Boeing"] },
    deadlineType: "fixed_date",
    deadlineDate: "2026-09-01",
    seasonYear: 2026,
    isActive: true,
  };

  it("marks a team eligible when all rules are met", () => {
    const outcome = evaluateGrantEligibility(baseProfile, grant);
    expect(outcome.isEligible).toBe(true);
    expect(outcome.score).toBe(100);
    expect(outcome.matchedReasons.length).toBe(2);
    expect(outcome.unmetReasons).toHaveLength(0);
  });

  it("marks a team ineligible and explains what's missing, never fabricating a pass", () => {
    const profile: TeamEligibilityProfile = { ...baseProfile, mentorEmployers: [], rookieYear: null };
    const outcome = evaluateGrantEligibility(profile, grant);
    expect(outcome.isEligible).toBe(false);
    expect(outcome.score).toBe(0);
    expect(outcome.unmetReasons).toContain("Rookie year not on file for this team");
    expect(outcome.unmetReasons).toContain("No mentor employers on file");
  });

  it("treats a grant with no rules as open eligibility", () => {
    const openGrant: CatalogGrant = { ...grant, eligibilityRules: {} };
    const outcome = evaluateGrantEligibility(baseProfile, openGrant);
    expect(outcome.isEligible).toBe(true);
    expect(outcome.score).toBe(100);
  });
});

describe("computeGrantEligibilityView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeGrantEligibilityView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the catalog is empty", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM grant_eligibility_matcher_catalog")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeGrantEligibilityView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") expect(view.orgId).toBe(ORG);
  });

  it("returns a live view scoring catalog grants against the team profile", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      if (sql.includes("FROM organizations WHERE id")) return { rows: [{ region: "CA" }] };
      if (sql.includes("FROM teams_ref")) return { rows: [{ rookieYear: 2024, country: "USA" }] };
      if (sql.includes("FROM team_background_profile")) {
        return { rows: [{ demographics: "Focus on underrepresented students", studentCount: 20, mentorCount: 4 }] };
      }
      if (sql.includes("FROM grant_eligibility_matcher_profile")) {
        return { rows: [{ mentorEmployers: ["Boeing Company"] }] };
      }
      if (sql.startsWith("SELECT id, name, funder") && sql.includes("FROM grant_eligibility_matcher_catalog")) {
        return {
          rows: [
            {
              id: GRANT_ID,
              name: "Boeing Rookie Grant",
              funder: "Boeing",
              description: null,
              amountMin: 1000,
              amountMax: 5000,
              applicationUrl: null,
              eligibilityRules: { maxRookieYears: 3, mentorEmployers: ["Boeing"] },
              deadlineType: "fixed_date",
              deadlineDate: "2026-09-01",
              seasonYear: 2026,
              isActive: true,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO grant_eligibility_matcher_matches")) return { rows: [] };
      if (sql.includes("FROM grant_eligibility_matcher_matches")) {
        return {
          rows: [
            {
              id: "match-1",
              grantId: GRANT_ID,
              isEligible: true,
              score: 100,
              matchedReasons: ["Rookie status: 2 year(s) active (limit 3)", "Mentor employer matches funder's list"],
              unmetReasons: [],
              deadlineFlaggedAt: null,
              dismissedAt: null,
              computedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeGrantEligibilityView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eligible).toHaveLength(1);
    expect(view.eligible[0]?.grant.name).toBe("Boeing Rookie Grant");
    expect(view.ineligible).toHaveLength(0);
    expect(view.profile.rookieYear).toBe(2024);
    expect(view.profile.mentorEmployers).toEqual(["Boeing Company"]);
  });
});
