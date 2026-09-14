"use client";

import { useEffect, useMemo, useState } from "react";
import { AiHubRelated } from "../../../components/ai-hub-related";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { UsageCutoffBanner } from "../../../components/usage-cutoff-banner";
import {
  AI_USAGE_RELATED_INCLUDE,
  aiBudgetsRelatedLinks,
  aiUsageNextActions,
  aiUsageShellCopy,
  classifyAiUsageShell,
  formatAiBudgetsCount,
  formatAiBudgetsMoney,
  shouldShowAiBudgetsSummaryTiles,
  type AiBudgetsShellKind,
} from "../../../lib/billing/ai-budgets-related";
import { buildUsageCutoffSnapshot } from "../../../lib/billing/usage-cutoff";
import { hubHref } from "../../../lib/nav/hubs";
import "../budgets/ai-budgets.css";

type UsageData = {
  members: Array<{ id: string; name: string | null; email: string | null; tokens: string; cost: string }>;
  models: Array<{ provider: string; model: string; tokens: string; cost: string; calls: string }>;
  entitlement: { planCode?: string; status?: string; includedAllowance?: string } | null;
  wallet: { balance: string; providerCost: string; markup: string } | null;
  policy: { paygEnabled?: boolean; spendCap?: string; killSwitch?: boolean } | null;
  allowancePercent: number | null;
  cutoff?: {
    planCode?: string | null;
    includedAllowanceUsd?: number;
    usedUsd?: number;
    walletBalanceUsd?: number;
    paygEnabled?: boolean;
    spendCapUsd?: number | null;
    killSwitch?: boolean;
    warningThresholds?: number[];
  };
};

type ActivityEvent = {
  id: string;
  createdAt: string;
  feature: string;
  provider: string;
  model: string;
  keySource: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
  usageTag: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

type ActivityData = {
  windowDays: number;
  summary: { calls: string; cost: string; tokens: string; cacheReadTokens: string };
  byKeySource: Array<{ keySource: string; calls: string; cost: string; tokens: string }>;
  byFeature: Array<{ feature: string; calls: string; cost: string; tokens: string }>;
  events: ActivityEvent[];
};

type DenialEvent = {
  id: string;
  createdAt: string;
  feature: string;
  provider: string | null;
  model: string | null;
  reason: string;
  estimatedCostUsd: string;
  estimatedTokens: number;
  actorName: string | null;
  actorEmail: string | null;
};

type DenialsData = {
  windowDays: number;
  total: number;
  byReason: Array<{ reason: string; count: string }>;
  events: DenialEvent[];
};

const KEY_SOURCE_LABELS: Record<string, string> = {
  platform: "Hosted",
  byo: "Your own key",
  local: "Local",
  local_cli: "This computer",
};

const FEATURE_LABELS: Record<string, string> = {
  strategy: "Strategy",
  team_intel: "Team intel",
  research: "Research",
  prediction: "Prediction",
  cad: "CAD",
  coding: "Coding",
  maintenance: "Maintenance",
  chat: "Assistant chat",
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;

// .admin-org is a 60px-badge grid; these rows are [content ... value], so flex-override it.
const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "12px",
};

// Budget-engine denial reasons are machine codes: fixed strings plus scoped
// limit codes like "org.daily_spend" / "member.monthly_tokens". Translate both.
function denialReasonLabel(reason: string): string {
  const fixed: Record<string, string> = {
    "org.kill_switch": "Chat paused for the team",
    kill_switch: "Chat paused for the team",
    "model.not_allowed": "This model is not allowed",
    "provider.not_allowed": "This provider is not allowed",
    spend_cap: "Overage spend cap reached",
    payg_not_enabled: "Pay-as-you-go disabled",
    insufficient_prepaid_balance: "Insufficient prepaid balance",
    sponsored_allowance_exhausted: "Sponsored allowance exhausted",
    sponsored_ai_unavailable: "Sponsored AI unavailable",
    commercial_approval_required: "Commercial approval required",
    verified_invited_member_required: "Verified invited member required",
    org_rate_limit: "Team daily rate limit",
    user_rate_limit: "Your daily rate limit",
    ip_rate_limit: "IP daily rate limit",
  };
  if (fixed[reason]) return fixed[reason];
  const scopeMatch = reason.match(/^(\w+)\.(daily|monthly)_(spend|tokens)$/);
  if (scopeMatch) {
    const scope = scopeMatch[1] === "org" ? "team" : scopeMatch[1];
    const period = scopeMatch[2] === "monthly" ? "Monthly" : "Daily";
    const kind = scopeMatch[3] === "tokens" ? "token" : "spend";
    return `${period} ${kind} limit (${scope})`;
  }
  return reason;
}

function UsageRelatedStrip({ orgId }: { orgId: string }) {
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const links = aiBudgetsRelatedLinks(orgId, { include: [...AI_USAGE_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ai-budgets-related" aria-label="Related AI usage tools">
      <Button as="a" variant="secondary" href={budgetsHref}>
        Budgets
      </Button>
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActions({ orgId, shell }: { orgId: string; shell: AiBudgetsShellKind }) {
  const actions = aiUsageNextActions({ orgId, shell });
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
  const primary = aiUsageNextActions({ orgId, shell }).find((action) => action.primary);
  if (!primary) return null;
  return (
    <Button as="a" variant="primary" href={primary.href}>
      {primary.label}
    </Button>
  );
}

export default function UsageClient({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [denials, setDenials] = useState<DenialsData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const budgetsHref = hubHref("/ai", "budgets", orgId);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError(null);
      const [usageResponse, activityResponse, denialsResponse] = await Promise.all([
        fetch(`/api/billing/usage?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/billing/activity?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/billing/denials?orgId=${encodeURIComponent(orgId)}`),
      ]);
      const usageData = await usageResponse.json();
      const activityData = await activityResponse.json();
      const denialsData = await denialsResponse.json();
      if (!active) return;
      const status = !usageResponse.ok
        ? usageResponse.status
        : !activityResponse.ok
          ? activityResponse.status
          : denialsResponse.ok
            ? usageResponse.status
            : denialsResponse.status;
      setHttpStatus(status);
      if (!usageResponse.ok) {
        setLoadError(usageData.error ?? "Unable to load usage");
        setMessage("");
        setLoading(false);
        return;
      }
      if (!activityResponse.ok) {
        setLoadError(activityData.error ?? "Unable to load activity");
        setMessage("");
        setLoading(false);
        return;
      }
      setLoadError(null);
      setMessage(denialsResponse.ok ? "" : (denialsData.error ?? ""));
      setUsage(usageData);
      setActivity(activityData);
      if (denialsResponse.ok) setDenials(denialsData);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const windowDays = activity?.windowDays ?? 30;
  const meteredCalls = Number(activity?.summary.calls ?? 0);

  const cutoffSnapshot = useMemo(() => {
    if (!usage) return null;
    if (usage.cutoff) {
      return buildUsageCutoffSnapshot({
        planCode: usage.cutoff.planCode ?? usage.entitlement?.planCode,
        includedAllowanceUsd: usage.cutoff.includedAllowanceUsd ?? usage.entitlement?.includedAllowance,
        usedUsd: usage.cutoff.usedUsd,
        walletBalanceUsd: usage.cutoff.walletBalanceUsd ?? usage.wallet?.balance,
        paygEnabled: usage.cutoff.paygEnabled ?? usage.policy?.paygEnabled,
        spendCapUsd: usage.cutoff.spendCapUsd ?? usage.policy?.spendCap,
        killSwitch: usage.cutoff.killSwitch ?? usage.policy?.killSwitch,
        warningThresholds: usage.cutoff.warningThresholds ?? [50, 75, 90],
      });
    }
    const used = usage.models.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
    return buildUsageCutoffSnapshot({
      planCode: usage.entitlement?.planCode,
      includedAllowanceUsd: usage.entitlement?.includedAllowance,
      usedUsd: used,
      walletBalanceUsd: usage.wallet?.balance,
      paygEnabled: usage.policy?.paygEnabled,
      spendCapUsd: usage.policy?.spendCap,
      killSwitch: usage.policy?.killSwitch,
      warningThresholds: [50, 75, 90],
    });
  }, [usage]);

  const shell = classifyAiUsageShell({
    loading,
    status: httpStatus,
    error: loadError,
    orgId,
    hasPlan: Boolean(usage?.entitlement?.planCode),
    meteredCalls,
  });
  const shellCopy = aiUsageShellCopy(shell);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "error";
  const showEmptyBanner = shell === "empty" || shell === "setup";
  const metricsLoaded = !loading && !blocked && usage != null;

  function retry() {
    setLoading(true);
    setLoadError(null);
    void (async () => {
      const [usageResponse, activityResponse, denialsResponse] = await Promise.all([
        fetch(`/api/billing/usage?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/billing/activity?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/billing/denials?orgId=${encodeURIComponent(orgId)}`),
      ]);
      const usageData = await usageResponse.json();
      const activityData = await activityResponse.json();
      const denialsData = await denialsResponse.json();
      setHttpStatus(usageResponse.status);
      if (!usageResponse.ok) {
        setLoadError(usageData.error ?? "Unable to load usage");
        setLoading(false);
        return;
      }
      if (!activityResponse.ok) {
        setLoadError(activityData.error ?? "Unable to load activity");
        setLoading(false);
        return;
      }
      setLoadError(null);
      setUsage(usageData);
      setActivity(activityData);
      if (denialsResponse.ok) setDenials(denialsData);
      setMessage(denialsResponse.ok ? "" : (denialsData.error ?? ""));
      setLoading(false);
    })();
  }

  return (
    <main className="intel-app ai-budgets-page ai-usage-page">
      <PageHeader
        breadcrumbs="Ask AI / Usage"
        title="Where the team's AI spend goes"
        description="A record of every billed Chat call — the model, the feature, the member, and which key funded it."
      />

      <AiHubRelated orgId={orgId} />
      <UsageRelatedStrip orgId={orgId} />

      {message ? (
        <p role="status" className="telemetry-status">
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
          <ShellPrimary orgId={orgId} shell={shell} onRetry={() => retry()} />
        </EmptyState>
      ) : null}

      {!loading && !blocked ? (
        <>
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

          {cutoffSnapshot ? <UsageCutoffBanner orgId={orgId} snapshot={cutoffSnapshot} /> : null}

          {shouldShowAiBudgetsSummaryTiles(shell) && activity ? (
            <section className="metric-grid">
              <article>
                <span>Calls · last {windowDays}d</span>
                <strong>{formatAiBudgetsCount(activity.summary.calls, metricsLoaded)}</strong>
              </article>
              <article>
                <span>Spend · last {windowDays}d</span>
                <strong>{formatAiBudgetsMoney(activity.summary.cost, metricsLoaded)}</strong>
              </article>
              <article>
                <span>Tokens · last {windowDays}d</span>
                <strong>{formatAiBudgetsCount(activity.summary.tokens, metricsLoaded)}</strong>
              </article>
              <article>
                <span>Cache-read tokens</span>
                <strong>{formatAiBudgetsCount(activity.summary.cacheReadTokens, metricsLoaded)}</strong>
              </article>
            </section>
          ) : null}

          {usage ? (
            <section className="admin-grid">
              <section className="intel-panel">
                <span className="eyebrow">FUNDING SOURCE · LAST {windowDays}D</span>
                {!activity?.byKeySource.length && (
                  <p className="app-muted">No metered calls in this window.</p>
                )}
                {activity?.byKeySource.map((row) => (
                  <article className="admin-org" style={rowStyle} key={row.keySource}>
                    <div>
                      <strong>{label(KEY_SOURCE_LABELS, row.keySource)}</strong>
                      <small>
                        {formatAiBudgetsCount(row.calls, true)} calls ·{" "}
                        {formatAiBudgetsCount(row.tokens, true)} tokens
                      </small>
                    </div>
                    <b>{formatAiBudgetsMoney(row.cost, true)}</b>
                  </article>
                ))}
              </section>
              <section className="intel-panel">
                <span className="eyebrow">SPEND BY FEATURE · LAST {windowDays}D</span>
                {!activity?.byFeature.length && (
                  <p className="app-muted">No metered calls in this window.</p>
                )}
                {activity?.byFeature.map((row) => (
                  <article className="admin-org" style={rowStyle} key={row.feature}>
                    <div>
                      <strong>{label(FEATURE_LABELS, row.feature)}</strong>
                      <small>
                        {formatAiBudgetsCount(row.calls, true)} calls ·{" "}
                        {formatAiBudgetsCount(row.tokens, true)} tokens
                      </small>
                    </div>
                    <b>{formatAiBudgetsMoney(row.cost, true)}</b>
                  </article>
                ))}
              </section>
            </section>
          ) : null}

          {usage ? (
            <section className="admin-grid">
              <section className="intel-panel">
                <span className="eyebrow">BY MEMBER · ALL TIME</span>
                {!usage.members.length && <p className="app-muted">No members yet.</p>}
                {usage.members
                  .slice()
                  .sort((a, b) => Number(b.cost) - Number(a.cost))
                  .map((member) => (
                    <article className="admin-org" style={rowStyle} key={member.id}>
                      <div>
                        <strong>{member.name ?? member.email ?? "Member"}</strong>
                        <small>{formatAiBudgetsCount(member.tokens, true)} tokens</small>
                      </div>
                      <b>{formatAiBudgetsMoney(member.cost, true)}</b>
                    </article>
                  ))}
              </section>
              <section className="intel-panel">
                <span className="eyebrow">BY AI · ALL TIME</span>
                {!usage.models.length && (
                  <p className="app-muted">No model usage recorded yet.</p>
                )}
                {usage.models.map((row) => (
                  <article className="admin-org" style={rowStyle} key={`${row.provider}/${row.model}`}>
                    <div>
                      <strong>{row.model}</strong>
                      <small>
                        {row.provider} · {formatAiBudgetsCount(row.calls, true)} calls ·{" "}
                        {formatAiBudgetsCount(row.tokens, true)} tokens
                      </small>
                    </div>
                    <b>{formatAiBudgetsMoney(row.cost, true)}</b>
                  </article>
                ))}
              </section>
            </section>
          ) : null}

          {denials ? (
            <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
              <span className="eyebrow">
                BLOCKED REQUESTS · {denials.total} IN LAST {denials.windowDays}D
              </span>
              <h2>AI calls stopped by policy</h2>
              <p className="app-muted">
                When a spend limit, a model list, or Pause Chat blocks a call, it is recorded here — so a feature that
                suddenly stops working can be traced to the exact control that caught it. Adjust caps on{" "}
                <a href={budgetsHref}>Chat limits</a>.
              </p>
              {!!denials.byReason.length && (
                <div className="tag-row" style={{ margin: "0.5rem 0 1rem" }}>
                  {denials.byReason.map((row) => (
                    <span key={row.reason}>
                      {denialReasonLabel(row.reason)} · {formatAiBudgetsCount(row.count, true)}
                    </span>
                  ))}
                </div>
              )}
              {!denials.events.length && (
                <p className="app-muted">No AI calls have been blocked.</p>
              )}
              {denials.events.map((event) => (
                <article className="admin-org" style={rowStyle} key={event.id}>
                  <div>
                    <strong>{denialReasonLabel(event.reason)}</strong>
                    <small>
                      {label(FEATURE_LABELS, event.feature)} ·{" "}
                      {event.actorName ?? event.actorEmail ?? "Member"}
                      {event.model ? ` · ${event.provider ?? "?"}/${event.model}` : ""} · ~
                      {formatAiBudgetsMoney(event.estimatedCostUsd, true)} /{" "}
                      {formatAiBudgetsCount(event.estimatedTokens, true)} tokens ·{" "}
                      {new Date(event.createdAt).toLocaleString()}
                    </small>
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {activity ? (
            <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
              <span className="eyebrow">RECENT ACTIVITY · LAST {activity.events.length} CALLS</span>
              {!activity.events.length && (
                <p className="app-muted">No AI calls have been metered for this team yet.</p>
              )}
              {activity.events.map((event) => (
                <article className="admin-org" style={rowStyle} key={event.id}>
                  <div>
                    <strong>
                      {label(FEATURE_LABELS, event.feature)}
                      {event.usageTag && event.usageTag !== event.feature ? ` · ${event.usageTag}` : ""}
                    </strong>
                    <small>
                      {event.actorName ?? event.actorEmail ?? "Member"} · {event.provider}/{event.model} ·{" "}
                      {label(KEY_SOURCE_LABELS, event.keySource)} ·{" "}
                      {formatAiBudgetsCount(event.totalTokens, true)} tokens
                      {Number(event.cacheReadTokens) > 0
                        ? ` (${formatAiBudgetsCount(event.cacheReadTokens, true)} cached)`
                        : ""}{" "}
                      · {new Date(event.createdAt).toLocaleString()}
                    </small>
                  </div>
                  <b>{formatAiBudgetsMoney(event.costUsd, true)}</b>
                </article>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
