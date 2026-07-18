"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../../components/ui";

const blank = {
  dailySpendLimitUsd: "",
  monthlySpendLimitUsd: "",
  dailyTokenLimit: "",
  monthlyTokenLimit: "",
};

const fieldLabel: Record<keyof typeof blank, string> = {
  dailySpendLimitUsd: "Daily spend limit (USD)",
  monthlySpendLimitUsd: "Monthly spend limit (USD)",
  dailyTokenLimit: "Daily token limit",
  monthlyTokenLimit: "Monthly token limit",
};

export default function BudgetClient({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = useState({
    ...blank,
    warningThresholds: "50,75,90",
    enforceByoTokenLimits: true,
    modelAllowlistEnabled: false,
    providerAllowlistEnabled: false,
    killSwitch: false,
    promptCachingEnabled: false,
  });
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [projected, setProjected] = useState<number | null>(null);
  const [layer, setLayer] = useState({
    scope: "feature",
    identifier: "research",
    provider: "",
    model: "",
    allowed: true,
    ...blank,
  });
  const [members, setMembers] = useState<Array<{ userId: string; name: string; email: string }>>([]);
  const [message, setMessage] = useState("");

  const q = `?orgId=${encodeURIComponent(orgId)}`;

  async function load() {
    const response = await fetch(`/api/billing/budgets?orgId=${orgId}`);
    const data = await response.json();
    if (data.policy) {
      setPolicy((prev) => ({
        ...prev,
        ...data.policy,
        warningThresholds: (data.policy.warningThresholds ?? [50, 75, 90]).join(","),
      }));
    }
    setUsage(data.usage ?? {});
    setProjected(data.projectedExhaustionDays ?? null);
    setMembers(data.members ?? []);
    if (!response.ok) setMessage(data.error);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(body: Record<string, unknown>) {
    const normalized = {
      ...body,
      orgId,
      dailySpendLimitUsd: body.dailySpendLimitUsd || null,
      monthlySpendLimitUsd: body.monthlySpendLimitUsd || null,
      dailyTokenLimit: body.dailyTokenLimit || null,
      monthlyTokenLimit: body.monthlyTokenLimit || null,
    };
    const response = await fetch("/api/billing/budgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalized),
    });
    const data = await response.json();
    setMessage(response.ok ? "Budget controls saved and audited." : data.error);
    if (response.ok) await load();
  }

  return (
    <main className="module-page budget-page">
      <PageHeader
        breadcrumbs="Team / API budgets"
        title="API budgets"
        description="Hard spend and token limits checked before every metered AI call. Pair with Team admin API keys and Team security delegation."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <a href={`/team${q}`}>Team admin</a>
          <a href={`/team${q}#custom-providers`}>API keys</a>
          <a href={`/team/security${q}`}>Team security</a>
          <a href={`/team/usage${q}`}>AI usage</a>
        </nav>
      </PageHeader>

      {message ? <p className="telemetry-status">{message}</p> : null}

      <section className="metric-grid">
        <article>
          <span>Spend today</span>
          <strong>${Number(usage.dailySpend ?? 0).toFixed(2)}</strong>
        </article>
        <article>
          <span>Spend this month</span>
          <strong>${Number(usage.monthlySpend ?? 0).toFixed(2)}</strong>
        </article>
        <article>
          <span>Tokens today</span>
          <strong>{Number(usage.dailyTokens ?? 0).toLocaleString()}</strong>
        </article>
        <article>
          <span>Projected exhaustion</span>
          <strong>{projected === null ? "—" : `${projected.toFixed(1)}d`}</strong>
        </article>
      </section>

      <section className="intel-panel" id="prompt-caching" style={{ marginBottom: 16 }}>
        <span className="eyebrow">Prompt caching</span>
        <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>Reuse stable system and context blocks</h2>
        <p className="app-muted" style={{ marginTop: 0 }}>
          When enabled, the assistant adapter can cache long-lived system/context prefixes to lower input cost. Turn off
          when you need the freshest team context on every call. Cache read/write tokens appear on{" "}
          <a href={`/team/usage${q}`}>AI usage</a>.
        </p>
        <label className="check-field">
          <input
            type="checkbox"
            checked={policy.promptCachingEnabled}
            onChange={(e) => setPolicy({ ...policy, promptCachingEnabled: e.target.checked })}
          />
          Enable prompt caching for this organization
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="primary-action"
            onClick={() =>
              void save({
                scope: "org",
                ...policy,
                warningThresholds: policy.warningThresholds.split(",").map(Number),
              })
            }
          >
            Save caching preference
          </button>
          <a className="app-button secondary" href={`/chat${q}`}>
            Open assistant
          </a>
        </div>
      </section>

      <section className="admin-grid">
        <form
          className="intel-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              scope: "org",
              ...policy,
              warningThresholds: policy.warningThresholds.split(",").map(Number),
            });
          }}
        >
          <span className="eyebrow">Organization hard limits</span>
          <div className="budget-fields">
            {(Object.keys(blank) as Array<keyof typeof blank>).map((key) => (
              <label key={key}>
                {fieldLabel[key]}
                <input
                  type="number"
                  min="0"
                  value={policy[key]}
                  onChange={(e) => setPolicy({ ...policy, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label>
            Warning thresholds (%)
            <input
              value={policy.warningThresholds}
              onChange={(e) => setPolicy({ ...policy, warningThresholds: e.target.value })}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={policy.enforceByoTokenLimits}
              onChange={(e) => setPolicy({ ...policy, enforceByoTokenLimits: e.target.checked })}
            />
            Apply token limits to BYOK/local
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={policy.modelAllowlistEnabled}
              onChange={(e) => setPolicy({ ...policy, modelAllowlistEnabled: e.target.checked })}
            />
            Enforce model allowlist
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={policy.providerAllowlistEnabled}
              onChange={(e) => setPolicy({ ...policy, providerAllowlistEnabled: e.target.checked })}
            />
            Enforce provider allowlist
          </label>
          <label className="check-field danger">
            <input
              type="checkbox"
              checked={policy.killSwitch}
              onChange={(e) => setPolicy({ ...policy, killSwitch: e.target.checked })}
            />
            Hard kill switch
          </label>
          <button className="primary-action">Save org limits</button>
        </form>

        <form
          className="intel-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const identity =
              layer.scope === "member"
                ? { userId: layer.identifier }
                : layer.scope === "feature"
                  ? { feature: layer.identifier }
                  : { provider: layer.provider, model: layer.model, allowed: layer.allowed };
            void save({ ...layer, ...identity });
          }}
        >
          <span className="eyebrow">Layered limit</span>
          <label>
            Scope
            <select value={layer.scope} onChange={(e) => setLayer({ ...layer, scope: e.target.value })}>
              <option value="feature">Feature</option>
              <option value="member">Member</option>
              <option value="model">Provider + model</option>
            </select>
          </label>
          {layer.scope === "member" ? (
            <label>
              Member
              <select
                value={layer.identifier}
                onChange={(e) => setLayer({ ...layer, identifier: e.target.value })}
              >
                <option value="">Choose member</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} · {m.email}
                  </option>
                ))}
              </select>
            </label>
          ) : layer.scope === "feature" ? (
            <label>
              Feature
              <input
                value={layer.identifier}
                onChange={(e) => setLayer({ ...layer, identifier: e.target.value })}
                placeholder="strategy, cad, coding, research…"
              />
            </label>
          ) : (
            <>
              <label>
                Provider
                <input
                  value={layer.provider}
                  onChange={(e) => setLayer({ ...layer, provider: e.target.value })}
                />
              </label>
              <label>
                Model (* for provider cap)
                <input value={layer.model} onChange={(e) => setLayer({ ...layer, model: e.target.value })} />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={layer.allowed}
                  onChange={(e) => setLayer({ ...layer, allowed: e.target.checked })}
                />
                Allowed
              </label>
            </>
          )}
          <div className="budget-fields">
            {(Object.keys(blank) as Array<keyof typeof blank>).map((key) => (
              <label key={key}>
                {fieldLabel[key]}
                <input
                  type="number"
                  min="0"
                  value={layer[key]}
                  onChange={(e) => setLayer({ ...layer, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <button className="primary-action">Save layered limit</button>
        </form>
      </section>
    </main>
  );
}
