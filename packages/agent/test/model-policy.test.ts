import { describe, expect, it } from "vitest";
import { BYOK_MODEL_OPTIONS, type ByokModelOption } from "../src/byok-model-routing";
import {
  applyModelPolicy,
  applyPolicyToRoutingPrefs,
  DEFAULT_ORG_MODEL_POLICY,
  isOrgModelPolicyMode,
  normalizeOrgModelPolicy,
  policyConstrainedPool,
  policySelectableModelIds,
  type OrgModelPolicy,
} from "../src/model-policy";

const catalog: readonly ByokModelOption[] = BYOK_MODEL_OPTIONS;

const allowAll: OrgModelPolicy = { mode: "allow_all", allowedModelIds: [] };
const forceAuto: OrgModelPolicy = { mode: "force_auto", allowedModelIds: [] };
const sonnetHaikuOnly: OrgModelPolicy = {
  mode: "allowlist",
  allowedModelIds: ["anthropic:claude-sonnet-5", "anthropic:claude-haiku-4-5"],
};

describe("normalizeOrgModelPolicy", () => {
  it("defaults to allow_all when nothing is stored", () => {
    expect(normalizeOrgModelPolicy(null)).toEqual(DEFAULT_ORG_MODEL_POLICY);
    expect(normalizeOrgModelPolicy(undefined)).toEqual(DEFAULT_ORG_MODEL_POLICY);
  });

  it("coerces unknown modes to allow_all", () => {
    expect(normalizeOrgModelPolicy({ mode: "banana" }).mode).toBe("allow_all");
    expect(normalizeOrgModelPolicy({ mode: null }).mode).toBe("allow_all");
  });

  it("keeps valid modes and dedupes/trims allowed ids", () => {
    const policy = normalizeOrgModelPolicy({
      mode: "allowlist",
      allowedModelIds: [" a ", "a", "", "b"],
    });
    expect(policy.mode).toBe("allowlist");
    expect(policy.allowedModelIds).toEqual(["a", "b"]);
  });

  it("isOrgModelPolicyMode covers exactly the three modes", () => {
    expect(isOrgModelPolicyMode("allow_all")).toBe(true);
    expect(isOrgModelPolicyMode("allowlist")).toBe(true);
    expect(isOrgModelPolicyMode("force_auto")).toBe(true);
    expect(isOrgModelPolicyMode("fixed")).toBe(false);
    expect(isOrgModelPolicyMode(undefined)).toBe(false);
  });
});

describe("applyModelPolicy — allow_all", () => {
  it("passes any requested model through untouched", () => {
    expect(applyModelPolicy(allowAll, "anthropic:claude-sonnet-5", catalog)).toEqual({
      modelId: "anthropic:claude-sonnet-5",
      coerced: false,
      reason: "allow_all",
    });
  });

  it("passes Auto (null) through untouched", () => {
    expect(applyModelPolicy(allowAll, null, catalog)).toEqual({
      modelId: null,
      coerced: false,
      reason: "allow_all",
    });
  });
});

describe("applyModelPolicy — force_auto", () => {
  it("ignores any member-fixed model and marks it coerced", () => {
    const decision = applyModelPolicy(forceAuto, "openai:gpt-4.1", catalog);
    expect(decision.modelId).toBeNull();
    expect(decision.coerced).toBe(true);
    expect(decision.reason).toBe("force_auto");
  });

  it("is not a coercion when the member already asked for Auto", () => {
    const decision = applyModelPolicy(forceAuto, null, catalog);
    expect(decision).toEqual({ modelId: null, coerced: false, reason: "force_auto" });
  });
});

describe("applyModelPolicy — allowlist", () => {
  it("keeps an allowed pick as-is", () => {
    expect(applyModelPolicy(sonnetHaikuOnly, "anthropic:claude-haiku-4-5", catalog)).toEqual({
      modelId: "anthropic:claude-haiku-4-5",
      coerced: false,
      reason: "allowed",
    });
  });

  it("permits Auto without coercion", () => {
    expect(applyModelPolicy(sonnetHaikuOnly, null, catalog)).toEqual({
      modelId: null,
      coerced: false,
      reason: "auto_requested",
    });
  });

  it("falls back to the best allowed model instead of erroring", () => {
    const decision = applyModelPolicy(sonnetHaikuOnly, "openai:gpt-4.1", catalog);
    // Sonnet 5 (mid) outranks Haiku 4.5 (fast).
    expect(decision.modelId).toBe("anthropic:claude-sonnet-5");
    expect(decision.coerced).toBe(true);
    expect(decision.reason).toBe("fallback_best_allowed");
  });

  it("prefers the cheaper model within the same tier", () => {
    const policy: OrgModelPolicy = {
      mode: "allowlist",
      // Both mid tier: gemini fetch not in mid; use sonnet-4 ($3) and sonnet-5 ($3),
      // plus two fast tier entries with different prices.
      allowedModelIds: ["openai:gpt-4.1-mini", "anthropic:claude-haiku-4-5"],
    };
    const decision = applyModelPolicy(policy, "google:gemini-2.5-pro", catalog);
    // Both allowed are fast tier; gpt-4.1-mini ($0.4/M) is cheaper than haiku ($1/M).
    expect(decision.modelId).toBe("openai:gpt-4.1-mini");
    expect(decision.coerced).toBe(true);
  });

  it("treats an empty allowlist as force_auto rather than an error", () => {
    const policy: OrgModelPolicy = { mode: "allowlist", allowedModelIds: [] };
    expect(applyModelPolicy(policy, "openai:gpt-4.1", catalog)).toEqual({
      modelId: null,
      coerced: true,
      reason: "empty_allowlist",
    });
    expect(applyModelPolicy(policy, null, catalog)).toEqual({
      modelId: null,
      coerced: false,
      reason: "empty_allowlist",
    });
  });

  it("falls back to automode when the allowlist only names stale ids", () => {
    const policy: OrgModelPolicy = {
      mode: "allowlist",
      allowedModelIds: ["anthropic:claude-retired-1"],
    };
    const decision = applyModelPolicy(policy, "openai:gpt-4.1", catalog);
    expect(decision.modelId).toBeNull();
    expect(decision.coerced).toBe(true);
    expect(decision.reason).toBe("empty_allowlist");
  });

  it("still honors a pinned stale id that exactly matches the allowlist", () => {
    const policy: OrgModelPolicy = {
      mode: "allowlist",
      allowedModelIds: ["anthropic:claude-retired-1"],
    };
    const decision = applyModelPolicy(policy, "anthropic:claude-retired-1", catalog);
    expect(decision).toEqual({
      modelId: "anthropic:claude-retired-1",
      coerced: false,
      reason: "allowed",
    });
  });
});

describe("policySelectableModelIds", () => {
  it("returns everything for allow_all", () => {
    expect(policySelectableModelIds(allowAll, catalog)).toEqual(catalog.map((m) => m.id));
  });

  it("returns nothing for force_auto", () => {
    expect(policySelectableModelIds(forceAuto, catalog)).toEqual([]);
  });

  it("filters to allowed catalog ids for allowlist", () => {
    expect(policySelectableModelIds(sonnetHaikuOnly, catalog)).toEqual([
      "anthropic:claude-sonnet-5",
      "anthropic:claude-haiku-4-5",
    ]);
  });
});

describe("policyConstrainedPool", () => {
  it("leaves the pool alone outside allowlist mode", () => {
    expect(policyConstrainedPool(allowAll, ["a", "b"], catalog)).toEqual(["a", "b"]);
    expect(policyConstrainedPool(forceAuto, ["a"], catalog)).toEqual(["a"]);
    expect(policyConstrainedPool(allowAll, null, catalog)).toBeNull();
  });

  it("intersects the enabled pool with the allowlist", () => {
    const pool = policyConstrainedPool(
      sonnetHaikuOnly,
      ["anthropic:claude-haiku-4-5", "openai:gpt-4.1"],
      catalog,
    );
    expect(pool).toEqual(["anthropic:claude-haiku-4-5"]);
  });

  it("uses the whole allowlist when the intersection is empty", () => {
    const pool = policyConstrainedPool(sonnetHaikuOnly, ["openai:gpt-4.1"], catalog);
    expect(pool).toEqual(["anthropic:claude-sonnet-5", "anthropic:claude-haiku-4-5"]);
  });
});

describe("applyPolicyToRoutingPrefs", () => {
  it("returns prefs unchanged under allow_all", () => {
    const prefs = { mode: "fixed" as const, fixedModelId: "openai:gpt-4.1", enabledModelIds: null };
    expect(applyPolicyToRoutingPrefs(allowAll, prefs, catalog)).toBe(prefs);
  });

  it("force_auto drops a fixed model and switches to automode", () => {
    const prefs = {
      mode: "fixed" as const,
      fixedModelId: "openai:gpt-4.1",
      enabledModelIds: ["openai:gpt-4.1"],
    };
    expect(applyPolicyToRoutingPrefs(forceAuto, prefs, catalog)).toEqual({
      mode: "automode",
      fixedModelId: null,
      enabledModelIds: ["openai:gpt-4.1"],
    });
  });

  it("allowlist keeps an allowed fixed model and narrows the pool", () => {
    const prefs = {
      mode: "fixed" as const,
      fixedModelId: "anthropic:claude-sonnet-5",
      enabledModelIds: ["anthropic:claude-sonnet-5", "openai:gpt-4.1"],
    };
    expect(applyPolicyToRoutingPrefs(sonnetHaikuOnly, prefs, catalog)).toEqual({
      mode: "fixed",
      fixedModelId: "anthropic:claude-sonnet-5",
      enabledModelIds: ["anthropic:claude-sonnet-5"],
    });
  });

  it("allowlist coerces a disallowed fixed model to the best allowed one", () => {
    const prefs = {
      mode: "fixed" as const,
      fixedModelId: "openai:gpt-4.1",
      enabledModelIds: null,
    };
    const result = applyPolicyToRoutingPrefs(sonnetHaikuOnly, prefs, catalog);
    expect(result.mode).toBe("fixed");
    expect(result.fixedModelId).toBe("anthropic:claude-sonnet-5");
  });

  it("empty allowlist falls back to automode over the stored pool", () => {
    const policy: OrgModelPolicy = { mode: "allowlist", allowedModelIds: [] };
    const prefs = {
      mode: "fixed" as const,
      fixedModelId: "openai:gpt-4.1",
      enabledModelIds: ["openai:gpt-4.1"],
    };
    expect(applyPolicyToRoutingPrefs(policy, prefs, catalog)).toEqual({
      mode: "automode",
      fixedModelId: null,
      enabledModelIds: ["openai:gpt-4.1"],
    });
  });

  it("allowlist automode narrows the pool but stays automode", () => {
    const prefs = {
      mode: "automode" as const,
      fixedModelId: null,
      enabledModelIds: ["openai:gpt-4.1", "anthropic:claude-haiku-4-5"],
    };
    expect(applyPolicyToRoutingPrefs(sonnetHaikuOnly, prefs, catalog)).toEqual({
      mode: "automode",
      fixedModelId: null,
      enabledModelIds: ["anthropic:claude-haiku-4-5"],
    });
  });
});
