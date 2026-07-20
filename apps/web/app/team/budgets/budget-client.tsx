"use client";

import { useEffect, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import { PageHeader } from "../../../components/ui";
import { UsageCutoffBanner } from "../../../components/usage-cutoff-banner";
import { HowToUseLink } from "../../help/how-to-use-link";
import {
  AI_BUDGETS_RELATED_INCLUDE,
  AI_BUDGETS_SCOPE_CARDS,
  aiBudgetsNextActions,
  aiBudgetsRelatedLinks,
  aiBudgetsShellCopy,
  classifyAiBudgetsShell,
  formatAiBudgetsCount,
  formatAiBudgetsMoney,
  policySnapshotFromBudgetForm,
  type AiBudgetsShellKind,
} from "../../../lib/billing/ai-budgets-related";
import { buildUsageCutoffSnapshot } from "../../../lib/billing/usage-cutoff";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import "./ai-budgets.css";

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

function BudgetsRelatedStrip({ orgId }: { orgId: string }) {
  const links = aiBudgetsRelatedLinks(orgId, { include: [...AI_BUDGETS_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-budgets-related" aria-label="Related AI budget tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActions({ orgId, shell }: { orgId: string; shell: AiBudgetsShellKind }) {
  const actions = aiBudgetsNextActions({ orgId, shell });
  if (!actions.length) return null;
  return (
    <section
      className="ai-budgets-next-actions app-card soft-panel edc-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p>From real org policy and Neon spend only — never DEMO $.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
  const [loading, setLoading] = useState(true);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const chatHref = hubHref("/ai", "chat", orgId);
  const usageHref = hubHref("/ai", "usage", orgId);
  const pricingHref = withOrgHref("/pricing", orgId);
  const accountHref = withOrgHref("/account", orgId);
  const adminHref = withOrgHref("/team/admin", orgId);
  const headerLinks = aiBudgetsRelatedLinks(orgId);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const response = await fetch(`/api/billing/budgets?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as {
      error?: string;
      policy?: Record<string, unknown> | null;
      usage?: Record<string, string>;
      projectedExhaustionDays?: number | null;
      members?: Array<{ userId: string; name: string; email: string }>;
      cutoff?: CutoffPayload | null;
    };
    setHttpStatus(response.status);
    if (!response.ok) {
      setLoadError(data.error ?? "Unable to load API budgets");
      setMessage("");
      setLoading(false);
      return;
    }
    setLoadError(null);
    if (data.policy) {
      const policy = data.policy;
      setPolicy((prev) => ({
        ...prev,
        ...policy,
        dailySpendLimitUsd:
          policy.dailySpendLimitUsd == null ? "" : String(policy.dailySpendLimitUsd),
        monthlySpendLimitUsd:
          policy.monthlySpendLimitUsd == null ? "" : String(policy.monthlySpendLimitUsd),
        dailyTokenLimit:
          policy.dailyTokenLimit == null ? "" : String(policy.dailyTokenLimit),
        monthlyTokenLimit:
          policy.monthlyTokenLimit == null ? "" : String(policy.monthlyTokenLimit),
        warningThresholds: ((policy.warningThresholds as number[] | undefined) ?? [50, 75, 90]).join(
          ",",
        ),
      }));
    } else {
      setPolicy((prev) => ({
        ...prev,
        ...blank,
        warningThresholds: "50,75,90",
        enforceByoTokenLimits: true,
        modelAllowlistEnabled: false,
        providerAllowlistEnabled: false,
        killSwitch: false,
        promptCachingEnabled: false,
      }));
    }
    setUsage(data.usage ?? {});
    setProjected(data.projectedExhaustionDays ?? null);
    setMembers(data.members ?? []);
    setCutoff(data.cutoff ?? null);
    setMessage("");
    setLoading(false);
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
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Budget controls saved and audited." : (data.error ?? "Save failed"));
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
        warningThresholds:
          cutoff.warningThresholds ??
          policy.warningThresholds.split(",").map(Number).filter(Number.isFinite),
      })
    : null;

  const shell = classifyAiBudgetsShell({
    loading,
    status: httpStatus,
    error: loadError,
    orgId,
    policy: loading || loadError ? null : policySnapshotFromBudgetForm(policy),
  });
  const shellCopy = aiBudgetsShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";
  const showEmptyBanner = shell === "empty" || shell === "setup";
  const metricsLoaded = !loading && !blocked;
  const allowanceLabel =
    metricsLoaded && snapshot?.allowancePercent != null
      ? `${Math.round(snapshot.allowancePercent)}%`
      : metricsLoaded
        ? "—"
        : "…";

  return (
    <main className="module-page budget-page ai-budgets-page">
      <PageHeader
        breadcrumbs="AI / API budgets"
        title="API budgets"
        description="Hard spend and token limits checked before every metered AI call. Included plan allowance hard-stops unless you buy Usage Credits or enable PAYG — no silent overage."
      >
        <nav className="settings-inline-links" aria-label="Related settings">
          <HowToUseLink slug="credits-vs-free" />
          {headerLinks
            .filter((link) =>
              ["chat", "usage", "pricing", "account", "governance", "admin"].includes(link.id),
            )
            .map((link) => (
              <a key={link.id} href={link.href}>
                {link.label}
              </a>
            ))}
          <a href={`${adminHref}#custom-providers`}>API keys</a>
        </nav>
      </PageHeader>

      <AiHubRelated orgId={orgId} active="budgets" />
      <BudgetsRelatedStrip orgId={orgId} />

      {message ? <p className="telemetry-status">{message}</p> : null}

      {loading ? (
        <section className="app-card soft-panel product-hub-setup" aria-busy>
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
        </section>
      ) : null}

      {blocked ? (
        <section className="app-card soft-panel product-hub-setup" role="status">
          {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">{shellCopy.description}</p>
          <NextActions orgId={orgId} shell={shell} />
          {shell === "error" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </section>
      ) : null}

      {!loading && !blocked ? (
        <>
          <section className="ai-budgets-scope" aria-label="What budgets owns">
            {AI_BUDGETS_SCOPE_CARDS.map((card) => (
              <article key={card.id} className="app-card soft-panel ai-budgets-scope-card">
                <span className="eyebrow">
                  {card.id === "limits"
                    ? "LIMITS"
                    : card.id === "usage"
                      ? "USAGE"
                      : card.id === "chat"
                        ? "CHAT"
                        : "PRICING"}
                </span>
                <h2>{card.title}</h2>
                <p className="app-muted">{card.body}</p>
                {card.id === "limits" ? (
                  <a className="app-button secondary" href="#org-hard-limits">
                    Edit hard limits
                  </a>
                ) : null}
                {card.id === "usage" ? (
                  <a className="app-button secondary" href={usageHref}>
                    Open AI usage
                  </a>
                ) : null}
                {card.id === "chat" ? (
                  <a className="app-button secondary" href={chatHref}>
                    Open Chat
                  </a>
                ) : null}
                {card.id === "pricing" ? (
                  <a className="app-button secondary" href={pricingHref}>
                    View pricing
                  </a>
                ) : null}
              </article>
            ))}
          </section>

          {showEmptyBanner ? (
            <section className="app-card soft-panel product-hub-setup" role="status">
              {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
              <h2>{shellCopy.title}</h2>
              <p className="app-muted">{shellCopy.description}</p>
              <NextActions orgId={orgId} shell={shell} />
            </section>
          ) : null}

          {snapshot ? <UsageCutoffBanner orgId={orgId} snapshot={snapshot} /> : null}

          <section className="metric-grid" aria-label="Usage snapshot">
            <article>
              <span>Spend today</span>
              <strong>{formatAiBudgetsMoney(usage.dailySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Spend this month</span>
              <strong>{formatAiBudgetsMoney(usage.monthlySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Included allowance used</span>
              <strong>{allowanceLabel}</strong>
            </article>
            <article>
              <span>Usage Credits</span>
              <strong>{formatAiBudgetsMoney(cutoff?.walletBalanceUsd, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Tokens today</span>
              <strong>{formatAiBudgetsCount(usage.dailyTokens, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Projected exhaustion</span>
              <strong>
                {!metricsLoaded ? "…" : projected === null ? "—" : `${projected.toFixed(1)}d`}
              </strong>
            </article>
          </section>

          <section className="intel-panel budget-cutoff-panel" aria-label="Hard cut-off options">
            <span className="eyebrow">Hard cut-offs</span>
            <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>After hosted AI runs out</h2>
            <p className="app-muted" style={{ marginTop: 0 }}>
              Plan{cutoff?.planCode ? ` (${cutoff.planCode})` : ""} hosted AI usage hard-stops at 100%. Resume with AI
              credits (hosted debit ~25% less than typical own-key rates), explicit PAYG + spend cap, or a higher plan.
              Your own keys / local do not consume hosted usage.
            </p>
            <div className="usage-cutoff-banner-ctas" style={{ marginTop: 4 }}>
              <UsageCutoffQuickActions
                orgId={orgId}
                paygEnabled={Boolean(cutoff?.paygEnabled)}
                pricingHref={pricingHref}
                accountHref={accountHref}
              />
            </div>
          </section>

          <section className="intel-panel" id="prompt-caching" style={{ marginBottom: 16 }}>
            <span className="eyebrow">Prompt caching</span>
            <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>Reuse stable system and context blocks</h2>
            <p className="app-muted" style={{ marginTop: 0 }}>
              When enabled, the assistant adapter can cache long-lived system/context prefixes to lower input cost. Turn
              off when you need the freshest team context on every call. Cache read/write tokens appear on{" "}
              <a href={usageHref}>AI usage</a>.
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
              <a className="app-button secondary" href={chatHref}>
                Open Chat
              </a>
            </div>
          </section>

          <section className="admin-grid">
            <form
              id="org-hard-limits"
              className="intel-panel ai-budgets-policy"
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
        </>
      ) : null}
    </main>
  );
}

function UsageCutoffQuickActions({
  orgId,
  paygEnabled,
  pricingHref,
  accountHref,
}: {
  orgId: string;
  paygEnabled: boolean;
  pricingHref: string;
  accountHref: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  async function checkout(
    action: "credits" | "payg" | "subscription",
    extra?: { packCode?: string; planCode?: string },
  ) {
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
        {busy === "credits" ? "Opening…" : "Buy AI credits"}
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
      <a className="app-button secondary" href={pricingHref}>
        View pricing
      </a>
      <a className="app-button secondary" href={accountHref}>
        Account
      </a>
      {hint ? <p className="usage-cutoff-hint">{hint}</p> : null}
    </>
  );
}
