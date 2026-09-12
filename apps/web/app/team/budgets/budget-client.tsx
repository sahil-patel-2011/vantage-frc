"use client";

import { useEffect, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import { PageHeader, Button, EmptyState } from "../../../components/ui";
import { UsageCutoffBanner } from "../../../components/usage-cutoff-banner";
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
  shouldShowAiBudgetsSummaryTiles,
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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShellPrimary({
  orgId,
  shell,
  onRetry,
}: {
  orgId: string;
  shell: AiBudgetsShellKind;
  onRetry?: () => void;
}) {
  if (shell === "error" && onRetry) {
    return (
      <Button variant="primary" type="button" onClick={onRetry}>
        Retry
      </Button>
    );
  }
  const primary = aiBudgetsNextActions({ orgId, shell }).find((action) => action.primary);
  if (!primary) return null;
  return (
    <Button as="a" variant="primary" href={primary.href}>
      {primary.label}
    </Button>
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
    promptCachingEnabled: true,
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
      setLoadError(data.error ?? "Unable to load Chat limits");
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
        promptCachingEnabled: true,
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
        breadcrumbs="Chat / Limits"
        title="Chat limits"
        description="Spend and token limits are checked before every Chat message. The included allowance stops unless you buy credits or turn on pay-as-you-go."
      />

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
        <EmptyState
          soft
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <ShellPrimary orgId={orgId} shell={shell} onRetry={() => void load()} />
        </EmptyState>
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
                  <Button as="a" variant="secondary" href="#org-hard-limits">
                    Edit spend limits
                  </Button>
                ) : null}
                {card.id === "usage" ? (
                  <Button as="a" variant="secondary" href={usageHref}>
                    Open AI usage
                  </Button>
                ) : null}
                {card.id === "chat" ? (
                  <Button as="a" variant="secondary" href={chatHref}>
                    Open Chat
                  </Button>
                ) : null}
                {card.id === "pricing" ? (
                  <Button as="a" variant="secondary" href={pricingHref}>
                    View pricing
                  </Button>
                ) : null}
              </article>
            ))}
          </section>

          {showEmptyBanner ? (
            <EmptyState
              soft
              badge={shellCopy.badge}
              badgeTone="setup"
              title={shellCopy.title}
              description={shellCopy.description}
            >
              <ShellPrimary orgId={orgId} shell={shell} />
            </EmptyState>
          ) : (
            <NextActions orgId={orgId} shell={shell} />
          )}

          {snapshot ? <UsageCutoffBanner orgId={orgId} snapshot={snapshot} /> : null}

          {shouldShowAiBudgetsSummaryTiles(shell) ? (
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
              <span>Credits</span>
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
          ) : null}

          <section className="intel-panel budget-cutoff-panel" aria-label="When hosted Chat runs out">
            <span className="eyebrow">When hosted Chat runs out</span>
            <h2 style={{ margin: "4px 0 8px", fontSize: 18 }}>After hosted AI runs out</h2>
            <p className="app-muted" style={{ marginTop: 0 }}>
              Plan{cutoff?.planCode ? ` (${cutoff.planCode})` : ""} hosted Chat stops at 100%. Resume with credits,
              pay-as-you-go with a spend cap, or a higher plan. Your own keys and local models do not use hosted allowance.
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
              <Button
                variant="primary"
                type="button"
                onClick={() =>
                  void save({
                    scope: "org",
                    ...policy,
                    warningThresholds: policy.warningThresholds.split(",").map(Number),
                  })
                }
              >
                Save caching preference
              </Button>
              <Button as="a" variant="secondary" href={chatHref}>
                Open Chat
              </Button>
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
              <span className="eyebrow">Team spend limits</span>
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
                Apply token limits to your keys / local
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={policy.modelAllowlistEnabled}
                  onChange={(e) => setPolicy({ ...policy, modelAllowlistEnabled: e.target.checked })}
                />
                Only allow the models I pick
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={policy.providerAllowlistEnabled}
                  onChange={(e) => setPolicy({ ...policy, providerAllowlistEnabled: e.target.checked })}
                />
                Only allow the providers I pick
              </label>
              <label className="check-field danger">
                <input
                  type="checkbox"
                  checked={policy.killSwitch}
                  onChange={(e) => setPolicy({ ...policy, killSwitch: e.target.checked })}
                />
                Pause Chat for everyone
              </label>
              <Button variant="primary" type="submit">Save limits</Button>
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
              <Button variant="primary" type="submit">Save layered limit</Button>
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
      <Button
        variant="primary"
        type="button"
        disabled={busy != null}
        onClick={() => void checkout("credits", { packCode: "credits_100" })}
      >
        {busy === "credits" ? "Opening…" : "Buy AI credits"}
      </Button>
      <Button variant="secondary" type="button" disabled={busy != null || paygEnabled} onClick={() => void checkout("payg")}>
        {paygEnabled ? "Pay-as-you-go is on" : busy === "payg" ? "Opening…" : "Turn on pay-as-you-go"}
      </Button>
      <Button variant="secondary" type="button" disabled={busy != null} onClick={() => void checkout("subscription", { planCode: "pro" })}>
        {busy === "subscription" ? "Opening…" : "Upgrade plan"}
      </Button>
      <Button as="a" variant="secondary" href={pricingHref}>
        View pricing
      </Button>
      <Button as="a" variant="secondary" href={accountHref}>
        Account
      </Button>
      {hint ? <p className="usage-cutoff-hint">{hint}</p> : null}
    </>
  );
}
