"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { formatCount, formatUsd } from "../../../lib/admin-analytics/compute";
import type {
  PlatformAnalytics,
  PlatformOrgDrilldown,
  PlatformOrgSummary,
} from "../../../lib/admin-analytics/queries";
import "./analytics.css";

// Platform-owner cockpit: every number is a real row read by /api/admin/
// analytics. An empty platform shows honest zeros — never demo metrics.

const SOURCE_LABELS: Record<string, string> = {
  messages: "Chat",
  scouting: "Scouting",
  tasks: "Tasks",
  hours: "Shop hours",
  decisions: "Decisions",
  cad: "CAD",
  incidents: "Incidents",
  ai: "AI",
};

const GROUP_LABELS: Record<string, string> = {
  hosted: "Hosted",
  byok: "Your keys",
  local: "Local",
  subscription: "Subscription bridge",
  other: "Other",
};

const sourceLabel = (source: string) => SOURCE_LABELS[source] ?? source;

/** Server-computed daily series rendered as inline SVG bars (repo-standard: no chart library). */
function BarChart({
  series,
  ariaLabel,
  format,
}: {
  series: Array<{ day: string; value: number }>;
  ariaLabel: string;
  format?: (value: number) => string;
}) {
  const width = 600;
  const height = 120;
  const realMax = Math.max(0, ...series.map((point) => point.value));
  const max = Math.max(1, realMax);
  const barWidth = width / Math.max(1, series.length);
  const fmt = format ?? ((value: number) => String(value));
  const first = series[0]?.day ?? "";
  const last = series[series.length - 1]?.day ?? "";
  return (
    <figure className="admin-analytics-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        {series.map((point, index) => {
          const barHeight = point.value > 0 ? Math.max(2, (point.value / max) * (height - 4)) : 0;
          return (
            <rect
              key={point.day}
              x={index * barWidth + barWidth * 0.15}
              y={height - barHeight}
              width={barWidth * 0.7}
              height={barHeight}
              rx={1.5}
            >
              <title>{`${point.day}: ${fmt(point.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption>
        <span>{first}</span>
        <span>peak {fmt(realMax)}</span>
        <span>{last}</span>
      </figcaption>
    </figure>
  );
}

function StatCards({ totals }: { totals: PlatformAnalytics["totals"] }) {
  const cards = [
    { label: "Teams", value: String(totals.orgs), hint: `${totals.orgsActive7d} active 7d · ${totals.orgsActive30d} active 30d` },
    { label: "Members", value: String(totals.members), hint: `${totals.membersActive7d} active 7d · ${totals.membersActive30d} active 30d` },
    { label: "AI calls · 60d", value: formatCount(totals.aiCalls), hint: `${formatCount(totals.aiTokens)} tokens` },
    { label: "AI spend · 60d", value: formatUsd(totals.aiCostUsd), hint: "metered ledger" },
  ];
  return (
    <div className="cards" aria-label="Platform totals">
      {cards.map((card) => (
        <article className="card" key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <small className="app-muted">{card.hint}</small>
        </article>
      ))}
    </div>
  );
}

function BreakdownTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<string>>;
}) {
  if (rows.length === 0) {
    return <p className="app-muted">No usage recorded in this window.</p>;
  }
  return (
    <div className="admin-analytics-table-wrap">
      <table className="admin-analytics-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgDrilldownPanel({
  drilldown,
  onClose,
}: {
  drilldown: PlatformOrgDrilldown;
  onClose: () => void;
}) {
  const { org } = drilldown;
  return (
    <Panel className="admin-analytics-drilldown" aria-label={`Team ${org.teamNumber ?? ""} drilldown`}>
      <div className="admin-analytics-drilldown-head">
        <div>
          <span className="eyebrow">Team drilldown · last {drilldown.window.days} days</span>
          <h2>
            {org.teamNumber != null ? `#${org.teamNumber} ` : ""}
            {org.name}
          </h2>
          <p className="app-muted">
            {org.members} member{org.members === 1 ? "" : "s"} · {org.activeMembers30d} active 30d ·{" "}
            {org.lastActiveDay ? `last active ${org.lastActiveDay}` : "no activity in window"} ·{" "}
            {org.daysActive} active day{org.daysActive === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="secondary" type="button" onClick={onClose}>
          Close
        </Button>
      </div>
      <BarChart series={drilldown.activity.perDay} ariaLabel="Team activity per day" />
      <div className="admin-analytics-columns">
        <section>
          <h3>Activity by source</h3>
          <BreakdownTable
            caption="Activity by source"
            columns={["Source", "Events"]}
            rows={drilldown.activity.bySource.map((row) => [sourceLabel(row.source), String(row.events)])}
          />
        </section>
        <section>
          <h3>AI usage</h3>
          <BreakdownTable
            caption="AI usage by key source"
            columns={["Keys", "Calls", "Tokens", "Cost"]}
            rows={drilldown.ai.byGroup.map((row) => [
              GROUP_LABELS[row.group] ?? row.group,
              String(row.calls),
              formatCount(row.tokens),
              formatUsd(row.costUsd),
            ])}
          />
          <BreakdownTable
            caption="AI usage by feature"
            columns={["Feature", "Calls", "Cost"]}
            rows={drilldown.ai.byFeature.map((row) => [row.feature, String(row.calls), formatUsd(row.costUsd)])}
          />
        </section>
      </div>
    </Panel>
  );
}

export default function AdminAnalyticsClient() {
  const [data, setData] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [drilldown, setDrilldown] = useState<PlatformOrgDrilldown | null>(null);
  const [drillBusy, setDrillBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/analytics");
        const payload = (await response.json()) as PlatformAnalytics & { error?: string };
        if (!active) return;
        setStatus(response.status);
        if (!response.ok) {
          setError(payload.error ?? "Could not load platform analytics.");
          setData(null);
        } else {
          setError(null);
          setData(payload);
        }
      } catch {
        if (!active) return;
        setStatus(null);
        setError("Network error loading platform analytics.");
        setData(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function openDrilldown(org: PlatformOrgSummary) {
    setDrillBusy(org.id);
    try {
      const response = await fetch(`/api/admin/analytics?org=${encodeURIComponent(org.id)}`);
      const payload = (await response.json()) as PlatformOrgDrilldown & { error?: string };
      if (response.ok) setDrilldown(payload);
      else setError(payload.error ?? "Could not load team drilldown.");
    } catch {
      setError("Network error loading team drilldown.");
    } finally {
      setDrillBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="module-page admin-control admin-analytics-page">
        <EmptyState soft title="Loading platform analytics…" description="Reading real activity and AI-usage rows." aria-busy />
      </main>
    );
  }

  if (!data) {
    const blockedTitle =
      status === 401
        ? "Sign in to continue"
        : status === 403 || status === 404
          ? "Platform admin access required"
          : "Platform analytics is unavailable";
    return (
      <main className="module-page admin-control admin-analytics-page">
        <PageHeader breadcrumbs="Platform / Analytics" title={blockedTitle} description={error ?? undefined} />
        <EmptyState soft title={blockedTitle} description={error ?? "Try again once the database is reachable."} />
      </main>
    );
  }

  const hasActivity = data.activity.perDay.some((point) => point.value > 0);
  const hasAi = data.ai.perDay.some((point) => point.calls > 0);

  return (
    <main className="module-page admin-control admin-analytics-page">
      <PageHeader
        breadcrumbs="Platform / Analytics"
        title="Platform analytics"
        description={`Real activity and metered AI usage across every provisioned team, ${data.window.start} → ${data.window.end}. Activity = any member-created row. Empty means genuinely empty.`}
      />

      <StatCards totals={data.totals} />

      <Panel aria-label="Platform activity">
        <span className="eyebrow">Activity per day · last {data.window.days} days</span>
        {hasActivity ? (
          <>
            <BarChart series={data.activity.perDay} ariaLabel="Member-created rows per day" />
            <div className="admin-analytics-chips" aria-label="Activity by source">
              {data.activity.bySource.map((row) => (
                <span key={row.source} className="admin-analytics-chip">
                  {sourceLabel(row.source)} · {formatCount(row.events)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="app-muted">No member activity recorded in this window yet.</p>
        )}
        <h3>Days-active per team</h3>
        {data.totals.orgs > 0 ? (
          <div className="admin-analytics-histogram" role="img" aria-label="Days-active histogram">
            {data.activity.histogram.map((bucket) => {
              const maxOrgs = Math.max(1, ...data.activity.histogram.map((b) => b.orgs));
              return (
                <div key={bucket.label} className="admin-analytics-histogram-row">
                  <small>{bucket.label}</small>
                  <span className="admin-analytics-histogram-bar">
                    <i style={{ width: `${(bucket.orgs / maxOrgs) * 100}%` }} />
                  </span>
                  <small>{bucket.orgs}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="app-muted">No teams provisioned yet — the histogram stays empty until real teams exist.</p>
        )}
      </Panel>

      <Panel aria-label="AI usage">
        <span className="eyebrow">AI usage · last {data.window.days} days</span>
        {hasAi ? (
          <>
            <div className="admin-analytics-columns">
              <section>
                <h3>Calls per day</h3>
                <BarChart series={data.ai.perDay.map((p) => ({ day: p.day, value: p.calls }))} ariaLabel="AI calls per day" />
              </section>
              <section>
                <h3>Cost per day</h3>
                <BarChart
                  series={data.ai.perDay.map((p) => ({ day: p.day, value: p.costUsd }))}
                  ariaLabel="AI cost per day in USD"
                  format={formatUsd}
                />
              </section>
            </div>
            <div className="admin-analytics-chips" aria-label="Usage by key source">
              {data.ai.byGroup.map((row) => (
                <span key={row.group} className="admin-analytics-chip">
                  {GROUP_LABELS[row.group] ?? row.group} · {formatCount(row.calls)} calls · {formatUsd(row.costUsd)}
                </span>
              ))}
            </div>
            <div className="admin-analytics-columns">
              <section>
                <h3>By model</h3>
                <BreakdownTable
                  caption="AI usage by model"
                  columns={["Provider", "Model", "Calls", "Tokens", "Cost"]}
                  rows={data.ai.byModel.map((row) => [
                    row.provider,
                    row.model,
                    String(row.calls),
                    formatCount(row.tokens),
                    formatUsd(row.costUsd),
                  ])}
                />
              </section>
              <section>
                <h3>By feature</h3>
                <BreakdownTable
                  caption="AI usage by feature"
                  columns={["Feature", "Calls", "Tokens", "Cost"]}
                  rows={data.ai.byFeature.map((row) => [
                    row.feature,
                    String(row.calls),
                    formatCount(row.tokens),
                    formatUsd(row.costUsd),
                  ])}
                />
              </section>
            </div>
          </>
        ) : (
          <p className="app-muted">No metered AI usage recorded in this window.</p>
        )}
      </Panel>

      {drilldown ? <OrgDrilldownPanel drilldown={drilldown} onClose={() => setDrilldown(null)} /> : null}

      <Panel aria-label="Teams">
        <span className="eyebrow">Per-team drilldown</span>
        {data.orgs.length === 0 ? (
          <p className="app-muted">
            No teams provisioned yet. <a href="/admin">Create the first workspace</a> from the Teams hub.
          </p>
        ) : (
          <div className="admin-analytics-table-wrap">
            <table className="admin-analytics-table">
              <caption className="sr-only">Provisioned teams</caption>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Members</th>
                  <th scope="col">Active 30d</th>
                  <th scope="col">Last active</th>
                  <th scope="col">Days active</th>
                  <th scope="col">Top source</th>
                  <th scope="col">AI calls</th>
                  <th scope="col">AI spend</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {data.orgs.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <strong>{org.teamNumber != null ? `#${org.teamNumber}` : org.slug}</strong> {org.name}
                    </td>
                    <td>{org.members}</td>
                    <td>{org.activeMembers30d}</td>
                    <td>{org.lastActiveDay ?? "—"}</td>
                    <td>{org.daysActive}</td>
                    <td>{org.topSource ? sourceLabel(org.topSource) : "—"}</td>
                    <td>{org.aiCalls}</td>
                    <td>{formatUsd(org.aiCostUsd)}</td>
                    <td>
                      <Button variant="secondary" type="button" onClick={() => void openDrilldown(org)} disabled={drillBusy === org.id}>
                        {drillBusy === org.id ? "Loading…" : "Details"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
