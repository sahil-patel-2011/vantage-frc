"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "../../../components/ui";
import { UsageCutoffBanner } from "../../../components/usage-cutoff-banner";
import { buildUsageCutoffSnapshot } from "../../../lib/billing/usage-cutoff";

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

type CutoffPayload = {
  planCode?: string | null;
  includedAllowanceUsd?: number;
  usedUsd?: number;
  walletBalanceUsd?: number;
  paygEnabled?: boolean;
  spendCapUsd?: number | null;
  killSwitch?: boolean;
  monthlySpendUsd?: number;
  monthlySpendLimitUsd?: number | null;
  warningThresholds?: number[];
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
  const [cutoff, setCutoff] = useState<CutoffPayload | null>(null);
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
    setCutoff(data.cutoff ?? null);
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

  const snapshot = cutoff
    ? buildUsageCutoffSnapshot({
        planCode: cutoff.planCode,
        includedAllowanceUsd: cutoff.includedAllowanceUsd,
        usedUsd: cutoff.usedUsd,
        walletBalanceUsd: cutoff.walletBalanceUsd,
        paygEnabled: cutoff.paygEnabled,
        spendCapUsd: cutoff.spendCapUsd,
        killSwitch: cutoff.killSwitch || policy.killSwitch,
        monthlySpendUsd: cutoff.monthlySpendUsd ?? usage.monthlySpend,
        monthlySpendLimitUsd: cutoff.monthlySpendLimitUsd ?? policy.monthlySpendLimitUsd,
        warningThresholds: cutoff.warningThresholds ??
          policy.warningThresholds.split(",").map(Number).filter(Number.isFinite),
      })
    : null;

  const allowanceLabel =
    snapshot?.allowancePercent != null ? `${Math.round(snapshot.allowancePercent)}%` : "—";

  return (
    <main className="module-page budget-page">
      <PageHeader
        breadcrumbs="Team / API budgets"
        title="API budgets"
        description="Hard spend and token limits checked before every metered AI call. Included plan allowance hard-stops unless you buy Usage Credits or enable PAYG — no silent overage."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <a href={`/team${q}`}>Team admin</a>
          <a href={`/team${q}#custom-providers`}>API keys</a>
          <a href={`/team/security${q}`}>Team security</a>
          <a href={`/team/usage${q}`}>AI usage</a>
          <a href="/pricing">Pricing</a>
        </nav>
      </PageHeader>

      {message ? <p className="telemetry-status">{message}</p> : null}

      {snapshot ? <UsageCutoffBanner orgId={orgId} snapshot={snapshot} /> : null}

      <section className="metric-grid" aria-label="Usage snapshot">
        <article>
          <span>Spend today</span>
          <strong>${Number(usage.dailySpend ?? 0).toFixed(2)}</strong>
        </article>
        <article>
          <span>Spend this month</span>
          <strong>${Number(usage.monthlySpend ?? 0).toFixed(2)}</strong>
        </article>
        <article>
          <span>Included allowance used</span>
          <strong>{allowanceLabel}</strong>
        </article>
        <article>
          <span>Usage Credits</span>
          <strong>${Number(cutoff?.walletBalanceUsd ?? 0).toFixed(2)}</strong>
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

      <section className="intel-panel budget-cutoff-panel" aria-label="Hard cut-off options">
        <span className="eyebrow">Hard cut-offs</span>
        <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>After included allowance</h2>
        <p className="app-muted" style={{ marginTop: 0 }}>
          Plan{cutoff?.planCode ? ` (${cutoff.planCode})` : ""} included API allowance hard-stops at 100%. Resume with
          prepaid Usage Credits (1 credit = $1 provider API at list rates), explicit PAYG + spend cap, or a higher plan.
          BYOK / local does not consume the managed allowance.
        </p>
        <div className="usage-cutoff-banner-ctas" style={{ marginTop: 4 }}>
          <UsageCutoffQuickActions orgId={orgId} paygEnabled={Boolean(cutoff?.paygEnabled)} />
        </div>
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

function UsageCutoffQuickActions({ orgId, paygEnabled }: { orgId: string; paygEnabled: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  async function checkout(action: "credits" | "payg" | "subscription", extra?: { packCode?: string; planCode?: string }) {
    setBusy(action);
    setHint("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action, ...extra }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setHint(data.error ?? "Checkout is not configured yet — open Pricing.");
    } catch {
      setHint("Checkout unavailable. Open Pricing instead.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="primary-action"
        disabled={busy != null}
        onClick={() => void checkout("credits", { packCode: "credits_100" })}
      >
        {busy === "credits" ? "Opening…" : "Buy Usage Credits"}
      </button>
      <button
        type="button"
        className="app-button secondary"
        disabled={busy != null || paygEnabled}
        onClick={() => void checkout("payg")}
      >
        {paygEnabled ? "PAYG enabled" : busy === "payg" ? "Opening…" : "Enable PAYG"}
      </button>
      <button
        type="button"
        className="app-button secondary"
        disabled={busy != null}
        onClick={() => void checkout("subscription", { planCode: "team_pro" })}
      >
        {busy === "subscription" ? "Opening…" : "Upgrade plan"}
      </button>
      <a className="app-button secondary" href="/pricing">
        View pricing
      </a>
      {hint ? <p className="usage-cutoff-hint">{hint}</p> : null}
    </>
  );
}
