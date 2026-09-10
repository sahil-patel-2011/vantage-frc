/**
 * Model SELECTION policy helpers for Soft-UI + API routes.
 *
 * `org_model_policy` controls which models members may PICK (allow_all /
 * allowlist / force_auto). It is deliberately named apart from billing's
 * `org_api_model_limits` / `model_allowlist_enabled`, which cap SPEND.
 */

import type { ByokModelOption } from "@vantage/agent";
import type { OrgModelPolicyMode } from "@vantage/agent";

export const MODEL_POLICY_MODE_META: Record<
  OrgModelPolicyMode,
  { label: string; description: string }
> = {
  allow_all: {
    label: "Allow all models",
    description: "Members may pick any model in the catalog, or leave it on Auto.",
  },
  allowlist: {
    label: "Only these models",
    description:
      "Members only see the models you check below. A pick outside the list quietly uses the best allowed model.",
  },
  force_auto: {
    label: "Auto only",
    description:
      "Members cannot pick a model. Automode routing decides by task toughness (CAD/code high, strategy mid, chat fast).",
  },
};

/** Keep only ids that exist in the catalog, deduped, preserving catalog order. */
export function sanitizeAllowedModelIds(
  ids: readonly string[] | null | undefined,
  catalog: readonly Pick<ByokModelOption, "id">[],
): string[] {
  const wanted = new Set(
    (ids ?? []).filter((id): id is string => typeof id === "string").map((id) => id.trim()),
  );
  return catalog.map((opt) => opt.id).filter((id) => wanted.has(id));
}

/** One-line status for the policy panel / selector hint. Honest, never invented. */
export function describeModelPolicy(
  mode: OrgModelPolicyMode,
  allowedCount: number,
): string {
  if (mode === "force_auto") return "Auto only — your team lead routes every request.";
  if (mode === "allowlist") {
    if (allowedCount <= 0) return "No models are checked — Auto routing is used until you pick some.";
    return allowedCount === 1
      ? "1 model is allowed, plus Auto."
      : `${allowedCount} models are allowed, plus Auto.`;
  }
  return "All catalog models are allowed, plus Auto.";
}

/** Label shown in place of the dropdown when members cannot pick. */
export const FORCE_AUTO_SELECTOR_LABEL = "Auto (set by your team)";
