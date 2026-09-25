"use client";

import { useEffect, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import { PageHeader, Button, EmptyState } from "../../../components/ui";
import {
  aiBudgetsNextActions,
  aiBudgetsShellCopy,
  classifyAiBudgetsShell,
  formatAiBudgetsCount,
  formatAiBudgetsMoney,
  policySnapshotFromBudgetForm,
  type AiBudgetsShellKind,
} from "../../../lib/billing/ai-budgets-related";
import { hubHref } from "../../../lib/nav/hubs";
import "./ai-budgets.css";

const blank = {
  dailySpendLimitUsd: "",
  monthlySpendLimitUsd: "",
  dailyTokenLimit: "",
  monthlyTokenLimit: "",
};

const fieldLabel: Record<keyof typeof blank, string> = {
  dailySpendLimitUsd: "Daily limit ($)",
  monthlySpendLimitUsd: "Monthly limit ($)",
  dailyTokenLimit: "Daily word limit (tokens)",
  monthlyTokenLimit: "Monthly word limit (tokens)",
};

function ShellPrimary({
  orgId,
  shell,
  canManage,
  onRetry,
}: {
  orgId: string;
  shell: AiBudgetsShellKind;
  canManage: boolean;
  onRetry?: () => void;
}) {
  if (shell === "error" && onRetry) {
    return (
      <Button variant="primary" type="button" onClick={onRetry}>
        Retry
      </Button>
    );
  }
  const primary = aiBudgetsNextActions({ orgId, shell, canManage }).find((action) => action.primary);
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
  /** Fail closed until the budget read says this account can manage keys. */
  const [canManage, setCanManage] = useState(false);
  const [noKey, setNoKey] = useState(false);

  const chatHref = hubHref("/ai", "chat", orgId);
  async function load() {
    setLoading(true);
    setLoadError(null);
    const response = await fetch(`/api/billing/budgets?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as {
      error?: string;
      canManage?: boolean;
      aiKeyConfigured?: boolean | null;
      policy?: Record<string, unknown> | null;
      usage?: Record<string, string>;
      members?: Array<{ userId: string; name: string; email: string }>;
    };
    setHttpStatus(response.status);
    if (!response.ok) {
      setLoadError(data.error ?? "Couldn't load AI limits");
      setCanManage(false);
      setMessage("");
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCanManage(data.canManage === true);
    setNoKey(data.aiKeyConfigured === false);
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
    setMembers(data.members ?? []);
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
    setMessage(response.ok ? "Saved." : (data.error ?? "Couldn't save. Try again."));
    if (response.ok) await load();
  }

  const shell = classifyAiBudgetsShell({
    loading,
    status: httpStatus,
    error: loadError,
    orgId,
    policy: loading || loadError ? null : policySnapshotFromBudgetForm(policy),
  });
  const shellCopy = aiBudgetsShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";
  const metricsLoaded = !loading && !blocked;
  const saveOrgPolicy = () =>
    void save({ scope: "org", ...policy, warningThresholds: policy.warningThresholds.split(",").map(Number) });

  return (
    <main className="module-page budget-page ai-budgets-page">
      <PageHeader
        breadcrumbs="AI / Limits"
        title="AI limits"
        description="Vantage's AI runs on your team's own key, so your provider bills your team directly. Set a monthly limit so it can't run up a surprise bill, or pause it for everyone."
      />

      <AiHubRelated orgId={orgId} active="budgets" />

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

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
          <ShellPrimary orgId={orgId} shell={shell} canManage={canManage} onRetry={() => void load()} />
        </EmptyState>
      ) : null}

      {!loading && !blocked ? (
        <>
          {noKey ? (
            <p className="ai-budgets-nokey" role="note">
              No AI key yet, so nothing has been spent. Limits apply once the team adds one.{" "}
              {canManage ? <a href={`/team/ai-keys?orgId=${encodeURIComponent(orgId)}`}>Add a key</a> : null}
            </p>
          ) : (
          <section className="metric-grid" aria-label="AI use">
            <article>
              <span>Spent today</span>
              <strong>{formatAiBudgetsMoney(usage.dailySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Spent this month</span>
              <strong>{formatAiBudgetsMoney(usage.monthlySpend, metricsLoaded)}</strong>
            </article>
            <article>
              <span>Words used today (tokens)</span>
              <strong>{formatAiBudgetsCount(usage.dailyTokens, metricsLoaded)}</strong>
            </article>
          </section>
          )}

          {!canManage ? (
            <EmptyState
              soft
              badge="Owners and mentors"
              badgeTone="setup"
              title="An owner or mentor sets the AI limits"
              description="AI follows the limits already saved. Ask an owner or mentor if something is blocked."
            >
              <Button as="a" variant="primary" href={chatHref}>
                Open Ask AI
              </Button>
            </EmptyState>
          ) : (
            <form
              id="org-hard-limits"
              className="intel-panel ai-budgets-policy"
              onSubmit={(e) => {
                e.preventDefault();
                saveOrgPolicy();
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>Team AI limits</h2>
              <p className="app-muted" style={{ margin: 0 }}>
                AI runs on your team&rsquo;s own key, and your provider bills you. A monthly limit stops it before a
                surprise bill. Leave blank for no limit.
              </p>
              <div className="budget-fields">
                {(["monthlySpendLimitUsd", "dailySpendLimitUsd"] as const).map((key) => (
                  <label key={key}>
                    {fieldLabel[key]}
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="No limit"
                      value={policy[key]}
                      onChange={(e) => setPolicy({ ...policy, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label className="check-field danger">
                <input
                  type="checkbox"
                  checked={policy.killSwitch}
                  onChange={(e) => setPolicy({ ...policy, killSwitch: e.target.checked })}
                />
                Pause AI for everyone on the team
              </label>
              <details className="ai-budgets-more">
                <summary>More controls</summary>
                <div className="budget-fields">
                  {(["monthlyTokenLimit", "dailyTokenLimit"] as const).map((key) => (
                    <label key={key}>
                      {fieldLabel[key]}
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        placeholder="No limit"
                        value={policy[key]}
                        onChange={(e) => setPolicy({ ...policy, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Warn at (% of the monthly limit, comma separated)
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
                  Count the word limits on personal keys too
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
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={policy.promptCachingEnabled}
                    onChange={(e) => setPolicy({ ...policy, promptCachingEnabled: e.target.checked })}
                  />
                  Reuse the team&rsquo;s standing instructions between questions (cheaper)
                </label>
              </details>
              <Button variant="primary" type="submit">
                Save limits
              </Button>
            </form>
          )}

          {canManage ? (
            <details className="intel-panel ai-budgets-more">
              <summary>A limit for one person, feature or model</summary>
              <form
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
                <label>
                  Limit applies to
                  <select value={layer.scope} onChange={(e) => setLayer({ ...layer, scope: e.target.value })}>
                    <option value="member">One person</option>
                    <option value="feature">One feature</option>
                    <option value="model">One provider or model</option>
                  </select>
                </label>
                {layer.scope === "member" ? (
                  <label>
                    Person
                    <select value={layer.identifier} onChange={(e) => setLayer({ ...layer, identifier: e.target.value })}>
                      <option value="">Choose a person</option>
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
                      <input value={layer.provider} onChange={(e) => setLayer({ ...layer, provider: e.target.value })} />
                    </label>
                    <label>
                      Model (leave * for every model)
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
                        placeholder="No limit"
                        value={layer[key]}
                        onChange={(e) => setLayer({ ...layer, [key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
                <Button variant="secondary" type="submit">
                  Save this limit
                </Button>
              </form>
            </details>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
