"use client";

import { useEffect, useState } from "react";

type UsageData = {
  members: Array<{ id: string; name: string | null; email: string | null; tokens: string; cost: string }>;
  models: Array<{ provider: string; model: string; tokens: string; cost: string; calls: string }>;
  entitlement: { planCode?: string; status?: string; includedAllowance?: string } | null;
  wallet: { balance: string; providerCost: string; markup: string } | null;
  policy: { paygEnabled?: boolean; spendCap?: string; killSwitch?: boolean } | null;
  allowancePercent: number | null;
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
  platform: "Platform key",
  byo: "BYO key",
  local: "Local",
  local_cli: "Local CLI",
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

const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
const num = (value: unknown) => Number(value ?? 0).toLocaleString();
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
    "org.kill_switch": "Kill switch active",
    kill_switch: "Kill switch active",
    "model.not_allowed": "Model not on allowlist",
    "provider.not_allowed": "Provider not on allowlist",
    spend_cap: "Overage spend cap reached",
    payg_not_enabled: "Pay-as-you-go disabled",
    insufficient_prepaid_balance: "Insufficient prepaid balance",
    sponsored_allowance_exhausted: "Sponsored allowance exhausted",
    sponsored_ai_unavailable: "Sponsored AI unavailable",
    commercial_approval_required: "Commercial approval required",
    verified_invited_member_required: "Verified invited member required",
    org_rate_limit: "Org daily rate limit",
    user_rate_limit: "Your daily rate limit",
    ip_rate_limit: "IP daily rate limit",
  };
  if (fixed[reason]) return fixed[reason];
  const scopeMatch = reason.match(/^(\w+)\.(daily|monthly)_(spend|tokens)$/);
  if (scopeMatch) {
    const scope = scopeMatch[1];
    const period = scopeMatch[2] === "monthly" ? "Monthly" : "Daily";
    const kind = scopeMatch[3] === "tokens" ? "token" : "spend";
    return `${period} ${kind} limit (${scope})`;
  }
  return reason;
}

export default function UsageClient({ orgId }: { orgId: string }) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [denials, setDenials] = useState<DenialsData | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [usageResponse, activityResponse, denialsResponse] = await Promise.all([
        fetch(`/api/billing/usage?orgId=${orgId}`),
        fetch(`/api/billing/activity?orgId=${orgId}`),
        fetch(`/api/billing/denials?orgId=${orgId}`),
      ]);
      const usageData = await usageResponse.json();
      const activityData = await activityResponse.json();
      const denialsData = await denialsResponse.json();
      if (!active) return;
      if (!usageResponse.ok) setMessage(usageData.error ?? "Unable to load usage");
      else if (!activityResponse.ok) setMessage(activityData.error ?? "Unable to load activity");
      else setMessage("");
      if (usageResponse.ok) setUsage(usageData);
      if (activityResponse.ok) setActivity(activityData);
      if (denialsResponse.ok) setDenials(denialsData);
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const windowDays = activity?.windowDays ?? 30;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI USAGE &amp; ACTIVITY</span>
          <h1>Where the team&apos;s AI spend goes</h1>
          <p className="app-muted">
            A transparent record of every metered AI call — the model, the feature, the member, and which key
            funded it. Set hard limits on the{" "}
            <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a> page.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Governance links">
          <a href={`/chat?orgId=${orgId}`}>Assistant</a>
          <a href={`/team/budgets?orgId=${orgId}#prompt-caching`}>Prompt caching</a>
          <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a>
          <a href={`/team/ai-policy?orgId=${orgId}`}>AI governance</a>
          <a href={`/team/ai-runs?orgId=${orgId}`}>AI runs</a>
          <a href={`/team/ai-memory?orgId=${orgId}`}>AI memory</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading usage…</p>}

      {!loading && activity && (
        <section className="metric-grid">
          <article>
            <span>Calls · last {windowDays}d</span>
            <strong>{num(activity.summary.calls)}</strong>
          </article>
          <article>
            <span>Spend · last {windowDays}d</span>
            <strong>{money(activity.summary.cost)}</strong>
          </article>
          <article>
            <span>Tokens · last {windowDays}d</span>
            <strong>{num(activity.summary.tokens)}</strong>
          </article>
          <article>
            <span>Cache-read tokens</span>
            <strong>{num(activity.summary.cacheReadTokens)}</strong>
          </article>
        </section>
      )}

      {!loading && usage && (
        <section className="admin-grid">
          <section className="intel-panel">
            <span className="eyebrow">FUNDING SOURCE · LAST {windowDays}D</span>
            {!activity?.byKeySource.length && <p className="app-muted">No metered calls in this window.</p>}
            {activity?.byKeySource.map((row) => (
              <article className="admin-org" style={rowStyle} key={row.keySource}>
                <div>
                  <strong>{label(KEY_SOURCE_LABELS, row.keySource)}</strong>
                  <small>{num(row.calls)} calls · {num(row.tokens)} tokens</small>
                </div>
                <b>{money(row.cost)}</b>
              </article>
            ))}
          </section>
          <section className="intel-panel">
            <span className="eyebrow">SPEND BY FEATURE · LAST {windowDays}D</span>
            {!activity?.byFeature.length && <p className="app-muted">No metered calls in this window.</p>}
            {activity?.byFeature.map((row) => (
              <article className="admin-org" style={rowStyle} key={row.feature}>
                <div>
                  <strong>{label(FEATURE_LABELS, row.feature)}</strong>
                  <small>{num(row.calls)} calls · {num(row.tokens)} tokens</small>
                </div>
                <b>{money(row.cost)}</b>
              </article>
            ))}
          </section>
        </section>
      )}

      {!loading && usage && (
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
                    <small>{num(member.tokens)} tokens</small>
                  </div>
                  <b>{money(member.cost)}</b>
                </article>
              ))}
          </section>
          <section className="intel-panel">
            <span className="eyebrow">BY MODEL · ALL TIME</span>
            {!usage.models.length && <p className="app-muted">No model usage recorded yet.</p>}
            {usage.models.map((row) => (
              <article className="admin-org" style={rowStyle} key={`${row.provider}/${row.model}`}>
                <div>
                  <strong>{row.model}</strong>
                  <small>{row.provider} · {num(row.calls)} calls · {num(row.tokens)} tokens</small>
                </div>
                <b>{money(row.cost)}</b>
              </article>
            ))}
          </section>
        </section>
      )}

      {!loading && denials && (
        <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
          <span className="eyebrow">
            BLOCKED REQUESTS · {denials.total} IN LAST {denials.windowDays}D
          </span>
          <h2>AI calls stopped by policy</h2>
          <p className="app-muted">
            When a budget limit, allowlist, or kill switch blocks a call, it is recorded here — so a feature
            that suddenly stops working can be traced to the exact control that caught it.
          </p>
          {!!denials.byReason.length && (
            <div className="tag-row" style={{ margin: "0.5rem 0 1rem" }}>
              {denials.byReason.map((row) => (
                <span key={row.reason}>
                  {denialReasonLabel(row.reason)} · {num(row.count)}
                </span>
              ))}
            </div>
          )}
          {!denials.events.length && <p className="app-muted">No AI calls have been blocked. Nice and clear.</p>}
          {denials.events.map((event) => (
            <article className="admin-org" style={rowStyle} key={event.id}>
              <div>
                <strong>{denialReasonLabel(event.reason)}</strong>
                <small>
                  {label(FEATURE_LABELS, event.feature)} ·{" "}
                  {event.actorName ?? event.actorEmail ?? "Member"}
                  {event.model ? ` · ${event.provider ?? "?"}/${event.model}` : ""} ·{" "}
                  ~{money(event.estimatedCostUsd)} / {num(event.estimatedTokens)} tokens ·{" "}
                  {new Date(event.createdAt).toLocaleString()}
                </small>
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && activity && (
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
                  {label(KEY_SOURCE_LABELS, event.keySource)} · {num(event.totalTokens)} tokens
                  {Number(event.cacheReadTokens) > 0 ? ` (${num(event.cacheReadTokens)} cached)` : ""} ·{" "}
                  {new Date(event.createdAt).toLocaleString()}
                </small>
              </div>
              <b>{money(event.costUsd)}</b>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
