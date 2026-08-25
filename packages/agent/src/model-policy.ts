/**
 * Org model SELECTION policy — which models members may pick, app-wide.
 *
 * This is about picking, not spending: billing's `org_api_model_limits` /
 * `model_allowlist_enabled` cap SPEND per model; `org_model_policy` (this module)
 * restricts which models are SELECTABLE. Pure decision logic only — DB loading
 * lives in resolve-chat-adapter, UI in apps/web.
 */

import type { ByokModelOption } from "./byok-model-routing";

export type OrgModelPolicyMode = "allow_all" | "allowlist" | "force_auto";

export type OrgModelPolicy = {
  mode: OrgModelPolicyMode;
  /** Catalog option ids (e.g. "anthropic:claude-sonnet-5"). Only used in allowlist mode. */
  allowedModelIds: string[];
};

export const ORG_MODEL_POLICY_MODES: readonly OrgModelPolicyMode[] = [
  "allow_all",
  "allowlist",
  "force_auto",
] as const;

export const DEFAULT_ORG_MODEL_POLICY: OrgModelPolicy = {
  mode: "allow_all",
  allowedModelIds: [],
};

export function isOrgModelPolicyMode(value: unknown): value is OrgModelPolicyMode {
  return (
    value === "allow_all" || value === "allowlist" || value === "force_auto"
  );
}

/** Coerce raw (DB / request) values into a safe policy. Unknown mode → allow_all. */
export function normalizeOrgModelPolicy(
  input?: { mode?: string | null; allowedModelIds?: string[] | null } | null,
): OrgModelPolicy {
  if (!input) return { ...DEFAULT_ORG_MODEL_POLICY };
  const mode = isOrgModelPolicyMode(input.mode) ? input.mode : "allow_all";
  const allowedModelIds = Array.from(
    new Set(
      (input.allowedModelIds ?? [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  return { mode, allowedModelIds };
}

export type ModelPolicyDecisionReason =
  | "allow_all"
  | "force_auto"
  | "auto_requested"
  | "allowed"
  | "fallback_best_allowed"
  | "empty_allowlist";

export type ModelPolicyDecision = {
  /** Concrete catalog option id to use, or null → automode routing decides. */
  modelId: string | null;
  /** True when the member's request was overridden by the policy. */
  coerced: boolean;
  reason: ModelPolicyDecisionReason;
};

const TIER_RANK: Record<string, number> = { high: 3, mid: 2, fast: 1 };

/** Highest tier first, then cheapest input price — the "best allowed" model. */
function bestOf(options: ByokModelOption[]): ByokModelOption | null {
  if (!options.length) return null;
  return [...options].sort((a, b) => {
    const rank = (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0);
    if (rank !== 0) return rank;
    return a.inputPerMillionUsd - b.inputPerMillionUsd;
  })[0]!;
}

/**
 * Apply the org selection policy to a member's requested model.
 * `requestedModelId === null` means the member asked for Auto.
 * Never throws — a disallowed pick falls back instead of erroring mid-chat.
 */
export function applyModelPolicy(
  policy: OrgModelPolicy,
  requestedModelId: string | null | undefined,
  catalog: readonly ByokModelOption[],
): ModelPolicyDecision {
  const requested = requestedModelId?.trim() || null;

  if (policy.mode === "force_auto") {
    return { modelId: null, coerced: requested != null, reason: "force_auto" };
  }

  if (policy.mode === "allow_all") {
    return { modelId: requested, coerced: false, reason: "allow_all" };
  }

  // allowlist
  const allowed = new Set(policy.allowedModelIds);
  if (!allowed.size) {
    // Nothing is allowed — behave like force_auto rather than erroring.
    return { modelId: null, coerced: requested != null, reason: "empty_allowlist" };
  }
  if (requested === null) {
    // Auto is always permitted; the automode pool is separately constrained.
    return { modelId: null, coerced: false, reason: "auto_requested" };
  }
  if (allowed.has(requested)) {
    return { modelId: requested, coerced: false, reason: "allowed" };
  }
  const fallback = bestOf(catalog.filter((opt) => allowed.has(opt.id)));
  if (fallback) {
    return { modelId: fallback.id, coerced: true, reason: "fallback_best_allowed" };
  }
  // Allowlist only names ids absent from the catalog (stale pins) — automode decides.
  return { modelId: null, coerced: true, reason: "empty_allowlist" };
}

/** Catalog option ids a member may pick under this policy (excludes Auto). */
export function policySelectableModelIds(
  policy: OrgModelPolicy,
  catalog: readonly ByokModelOption[],
): string[] {
  if (policy.mode === "force_auto") return [];
  if (policy.mode === "allow_all") return catalog.map((opt) => opt.id);
  const allowed = new Set(policy.allowedModelIds);
  return catalog.filter((opt) => allowed.has(opt.id)).map((opt) => opt.id);
}

/**
 * Constrain an automode pool to the policy. Returns ids automode may route to.
 * Empty result means "no constraint satisfiable" — callers keep their own
 * fallback rather than erroring.
 */
export function policyConstrainedPool(
  policy: OrgModelPolicy,
  enabledModelIds: string[] | null | undefined,
  catalog: readonly ByokModelOption[],
): string[] | null {
  if (policy.mode !== "allowlist") return enabledModelIds ?? null;
  const allowedIds = policySelectableModelIds(policy, catalog);
  if (!allowedIds.length) return enabledModelIds ?? null;
  const enabled = enabledModelIds?.filter(Boolean) ?? [];
  const intersection = enabled.filter((id) => allowedIds.includes(id));
  return intersection.length ? intersection : allowedIds;
}

export type RoutingPrefsLike = {
  mode: "fixed" | "automode";
  fixedModelId: string | null;
  enabledModelIds: string[] | null;
};

/**
 * Apply the org policy to loaded routing prefs before adapter resolution.
 * - force_auto  → automode, fixed pick dropped.
 * - allowlist   → fixed pick outside the list falls back to the best allowed
 *                 model; the automode pool is narrowed to allowed models.
 * - allow_all   → unchanged.
 */
export function applyPolicyToRoutingPrefs(
  policy: OrgModelPolicy,
  prefs: RoutingPrefsLike,
  catalog: readonly ByokModelOption[],
): RoutingPrefsLike {
  if (policy.mode === "allow_all") return prefs;
  if (policy.mode === "force_auto") {
    return { mode: "automode", fixedModelId: null, enabledModelIds: prefs.enabledModelIds };
  }
  const enabledModelIds = policyConstrainedPool(policy, prefs.enabledModelIds, catalog);
  if (prefs.mode === "fixed") {
    const decision = applyModelPolicy(policy, prefs.fixedModelId, catalog);
    if (decision.modelId) {
      return { mode: "fixed", fixedModelId: decision.modelId, enabledModelIds };
    }
    return { mode: "automode", fixedModelId: null, enabledModelIds };
  }
  return { mode: "automode", fixedModelId: null, enabledModelIds };
}
