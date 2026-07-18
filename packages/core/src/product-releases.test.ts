import { describe, expect, it } from "vitest";
import {
  audienceIncludesPlan,
  mergeEntitlementFeatureFlags,
  planMeetsMinPlan,
  releaseTargetsPlan,
  PRODUCT_PLAN_RANK,
} from "./product-releases";

describe("product release targeting", () => {
  it("matches audience cohorts", () => {
    expect(audienceIncludesPlan("all", [], "free")).toBe(true);
    expect(audienceIncludesPlan("paid", [], "free")).toBe(false);
    expect(audienceIncludesPlan("paid", [], "team_pro")).toBe(true);
    expect(audienceIncludesPlan("max", [], "team_pro")).toBe(false);
    expect(audienceIncludesPlan("max", [], "team_max")).toBe(true);
    expect(audienceIncludesPlan("plan_codes", ["team_pro"], "team_pro")).toBe(true);
    expect(audienceIncludesPlan("plan_codes", ["team_pro"], "free")).toBe(false);
  });

  it("applies min_plan rank gates", () => {
    expect(planMeetsMinPlan("free", null)).toBe(true);
    expect(planMeetsMinPlan("team_pro", "access")).toBe(true);
    expect(planMeetsMinPlan("access", "team_pro")).toBe(false);
    expect(PRODUCT_PLAN_RANK.individual_max).toBe(PRODUCT_PLAN_RANK.team_max);
  });

  it("combines audience + min_plan", () => {
    expect(
      releaseTargetsPlan(
        { audienceType: "paid", audiencePlanCodes: [], minPlan: "team_pro" },
        "access",
      ),
    ).toBe(false);
    expect(
      releaseTargetsPlan(
        { audienceType: "paid", audiencePlanCodes: [], minPlan: "team_pro" },
        "team_max",
      ),
    ).toBe(true);
  });

  it("merges release flags onto plan flags", () => {
    expect(
      mergeEntitlementFeatureFlags(
        { advanced_strategy: true, strategy_engine_v2: false },
        { strategy_engine_v2: true },
      ),
    ).toEqual({ advanced_strategy: true, strategy_engine_v2: true });
  });
});
