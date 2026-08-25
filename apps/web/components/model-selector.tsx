"use client";

import { useEffect, useState } from "react";
import {
  describeModelPolicy,
  FORCE_AUTO_SELECTOR_LABEL,
} from "../lib/ai-keys/model-policy-related";
import "./model-selector.css";

/**
 * Shared model dropdown, constrained by the org's model SELECTION policy
 * (`/api/organizations/model-policy`). Controlled: `value` is a catalog option
 * id (e.g. "anthropic:claude-sonnet-5") or null for Auto; the page owns
 * persistence via `onChange`. Under force_auto it renders only the label
 * "Auto (set by your team)". Disallowed options are simply hidden.
 */

export type ModelSelectorCatalogEntry = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  tier: string;
  tierLabel: string;
};

type PolicyPayload = {
  mode: "allow_all" | "allowlist" | "force_auto";
  allowedModelIds: string[];
  catalog: ModelSelectorCatalogEntry[];
  error?: string;
};

export function ModelSelector({
  orgId,
  value,
  onChange,
  label = "Model",
  disabled = false,
}: {
  orgId: string | null;
  /** Catalog option id, or null for Auto. */
  value: string | null;
  onChange: (modelId: string | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [policy, setPolicy] = useState<PolicyPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(orgId));

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setPolicy(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/organizations/model-policy?orgId=${encodeURIComponent(orgId)}`,
        );
        const data = (await response.json()) as PolicyPayload;
        if (cancelled) return;
        if (!response.ok) {
          setFailed(true);
          setPolicy(null);
        } else {
          setPolicy(data);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setPolicy(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!orgId) return null;

  if (loading) {
    return (
      <div className="model-selector" aria-busy="true">
        <span className="model-selector-label">{label}</span>
        <span className="model-selector-hint">Loading model policy…</span>
      </div>
    );
  }

  if (failed || !policy) {
    return (
      <div className="model-selector" role="status">
        <span className="model-selector-label">{label}</span>
        <span className="model-selector-hint">
          Could not load your team&apos;s model policy — Auto routing is used.
        </span>
      </div>
    );
  }

  if (policy.mode === "force_auto") {
    return (
      <div className="model-selector" role="status">
        <span className="model-selector-label">{label}</span>
        <span className="model-selector-forced">{FORCE_AUTO_SELECTOR_LABEL}</span>
      </div>
    );
  }

  const allowed =
    policy.mode === "allowlist"
      ? policy.catalog.filter((opt) => policy.allowedModelIds.includes(opt.id))
      : policy.catalog;
  const valuePermitted = value === null || allowed.some((opt) => opt.id === value);

  return (
    <label className="model-selector">
      <span className="model-selector-label">{label}</span>
      <select
        className="model-selector-select"
        value={valuePermitted && value ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Auto — routed by task</option>
        {allowed.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label} · {opt.tierLabel}
          </option>
        ))}
      </select>
      {!valuePermitted ? (
        <span className="model-selector-hint" role="note">
          Your saved model is no longer allowed by team policy — Auto is used instead.
        </span>
      ) : null}
      <span className="model-selector-hint">
        {describeModelPolicy(policy.mode, allowed.length)}
      </span>
    </label>
  );
}
