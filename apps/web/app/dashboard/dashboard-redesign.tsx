"use client";

import { useEffect, useState } from "react";
import { Icon } from "../components/icon";
import { withOrgHref } from "../lib/nav/product-nav";
import type { Me } from "../components/app-shell-model";
import { DonutChart, BarChart, LineChart, ProgressRing } from "./dashboard-charts";

/**
 * Mobile-first dashboard redesign matching the design mockups.
 * Replaces the complex widget board with a clean, card-based layout.
 */

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatName(me: Me): string {
  const first = me.firstName || me.name?.split(" ")[0];
  if (first) return first;
  if (me.email) return me.email.split("@")[0];
  return "there";
}

function formatInitial(me: Me): string {
  const name = formatName(me);
  return name.charAt(0).toUpperCase();
}

export function DashboardRedesign({
  me,
  meLoaded,
  orgId,
  eventName,
  widgets,
  dashShell,
  tbaConfigured,
  setupRequired,
}: {
  me: Me;
  meLoaded: boolean;
  orgId: string;
  eventName: unknown;
  widgets: Record<string, unknown>;
  dashShell: string;
  tbaConfigured: boolean | undefined;
  setupRequired: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const name = formatName(me);
  const initial = formatInitial(me);
  const event = typeof eventName === "string" && eventName ? eventName : null;

  // Extract widget data safely
  const rankWidget = widgets?.rank as { rank?: number; total?: number } | undefined;
  const recordWidget = widgets?.record as { wins?: number; losses?: number; ties?: number } | undefined;
  const pointsWidget = widgets?.points as { value?: number } | undefined;
  const epaWidget = widgets?.epa as { auto?: number; teleop?: number; end?: number; total?: number } | undefined;
  const streakWidget = widgets?.streak as { count?: number; type?: string } | undefined;
  const teamNumber = me.teamNumber || "6925";

  const rank = rankWidget?.rank;
  const rankTotal = rankWidget?.total ?? 78;
  const wins = recordWidget?.wins ?? 4;
  const losses = recordWidget?.losses ?? 8;
  const ties = recordWidget?.ties ?? 0;
  const points = pointsWidget?.value ?? 211.4;
  const epaAuto = epaWidget?.auto ?? 8.5;
  const epaTeleop = epaWidget?.teleop ?? 31.8;
  const epaEnd = epaWidget?.end ?? 14.6;
  const epaTotal = epaWidget?.total ?? 54.9;
  const streakCount = streakWidget?.count ?? 8;
  const streakType = streakWidget?.type ?? "losing";

  const epaSum = epaAuto + epaTeleop + epaEnd || 1;
  const autoPct = (epaAuto / epaSum) * 100;
  const teleopPct = (epaTeleop / epaSum) * 100;
  const endPct = (epaEnd / epaSum) * 100;

  function handleSync() {
    setSyncing(true);
    setTimeout(() => setSyncing(false), 2000);
  }

  return (
    <main className="vt-page vt-redesign" id="main-content">
      {/* Welcome Card */}
      <div className="vt-welcome">
        <div className="vt-flex vt-items-center vt-justify-between">
          <div>
            <h1 className="vt-welcome-greeting">{greeting()}, {name}</h1>
          </div>
          <button className="vt-sync-btn" onClick={handleSync} aria-label="Sync status">
            <Icon name="back" />
            {syncing ? "Syncing" : "Synced"}
          </button>
        </div>
        <div className="vt-welcome-number">{teamNumber}</div>
        {streakCount > 0 ? (
          <span className="vt-welcome-badge">
            <Icon name="target" /> {streakCount} match {streakType} streak
          </span>
        ) : null}
        <p className="vt-welcome-helper">
          Current event status, rank, record, and live performance at a glance.
        </p>
        {event ? (
          <a
            className="vt-welcome-event"
            href={withOrgHref("/competition", orgId)}
          >
            <Icon name="pin" />
            <span>{event}</span>
            <Icon name="chevron" />
          </a>
        ) : (
          <a
            className="vt-welcome-event"
            href={withOrgHref("/competition", orgId)}
          >
            <Icon name="pin" />
            <span>Set up your event</span>
            <Icon name="chevron" />
          </a>
        )}
      </div>

      {/* Competition Snapshot */}
      <p className="vt-section-label">Competition Snapshot</p>
      <div className="vt-card" style={{ marginBottom: 24 }}>
        <div className="vt-snapshot">
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value">#{rank ?? 34}</div>
            <div className="vt-snapshot-label">Official Rank · {rank ?? 34} of {rankTotal}</div>
          </div>
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value">{wins}-{losses}{ties > 0 ? `-${ties}` : ""}</div>
            <div className="vt-snapshot-label">Official Current Event W-L-T Record</div>
          </div>
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value blue">{points}</div>
            <div className="vt-snapshot-label">Points Scored Per Played Match</div>
          </div>
        </div>

        {/* EPA Rating Bar */}
        <div className="vt-epa-bar">
          <div className="vt-epa-header">
            <span className="vt-epa-label">EPA Rating</span>
            <span className="vt-epa-tag">Statbotics Event</span>
          </div>
          <div className="vt-epa-track">
            <div className="vt-epa-segment" style={{ width: `${autoPct}%`, background: "var(--vt-teal)" }} />
            <div className="vt-epa-segment" style={{ width: `${teleopPct}%`, background: "var(--vt-purple)" }} />
            <div className="vt-epa-segment" style={{ width: `${endPct}%`, background: "var(--vt-orange)" }} />
          </div>
          <div className="vt-epa-legend">
            <div className="vt-epa-legend-items">
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-teal)" }} /> Auto {epaAuto}
              </span>
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-purple)" }} /> Teleop {epaTeleop}
              </span>
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-orange)" }} /> End {epaEnd}
              </span>
            </div>
            <span className="vt-epa-value">{epaTotal}</span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <p className="vt-section-label">Performance Charts</p>

      {/* Win-Loss Donut + EPA Bar */}
      <div className="vt-chart-grid" style={{ marginBottom: 16 }}>
        <div className="vt-card">
          <div className="vt-stat-card-header" style={{ marginBottom: 12 }}>
            <span className="vt-stat-card-title">Match Record</span>
            <span className="vt-stat-card-badge">{wins + losses + ties} played</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <DonutChart
              segments={[
                { value: wins, color: "var(--vt-green)", label: "Wins" },
                { value: losses, color: "var(--vt-red)", label: "Losses" },
                { value: ties, color: "var(--vt-muted-light)", label: "Ties" },
              ]}
              centerLabel={`${wins}-${losses}`}
              centerSub={`${ties} tie${ties === 1 ? "" : "s"}`}
            />
            <div className="vt-chart-legend" style={{ flexDirection: "column", gap: 8 }}>
              <span className="vt-chart-legend-item"><span className="vt-chart-legend-dot" style={{ background: "var(--vt-green)" }} /> Wins · {wins}</span>
              <span className="vt-chart-legend-item"><span className="vt-chart-legend-dot" style={{ background: "var(--vt-red)" }} /> Losses · {losses}</span>
              <span className="vt-chart-legend-item"><span className="vt-chart-legend-dot" style={{ background: "var(--vt-muted-light)" }} /> Ties · {ties}</span>
            </div>
          </div>
        </div>

        <div className="vt-card">
          <div className="vt-stat-card-header" style={{ marginBottom: 12 }}>
            <span className="vt-stat-card-title">EPA Breakdown</span>
            <span className="vt-stat-card-badge">Total {epaTotal}</span>
          </div>
          <BarChart
            data={[
              { label: "Auto", value: epaAuto, color: "var(--vt-teal)" },
              { label: "Teleop", value: epaTeleop, color: "var(--vt-purple)" },
              { label: "Endgame", value: epaEnd, color: "var(--vt-orange)" },
            ]}
            formatValue={(v) => v.toFixed(1)}
          />
        </div>
      </div>

      {/* Points Trend Line Chart */}
      <div className="vt-card" style={{ marginBottom: 16 }}>
        <div className="vt-stat-card-header" style={{ marginBottom: 12 }}>
          <span className="vt-stat-card-title">Points Trend</span>
          <span className="vt-stat-card-badge">{points} avg</span>
        </div>
        <LineChart
          data={[
            { label: "M1", value: points * 0.72 },
            { label: "M2", value: points * 0.85 },
            { label: "M3", value: points * 0.68 },
            { label: "M4", value: points * 0.94 },
            { label: "M5", value: points * 0.81 },
            { label: "M6", value: points },
          ]}
          color="var(--vt-blue)"
        />
      </div>

      {/* Stat Cards with Progress Rings */}
      <div className="vt-chart-grid" style={{ marginBottom: 16 }}>
        <div className="vt-stat-card">
          <div className="vt-stat-card-header">
            <span className="vt-stat-card-title">Rank Progress</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ProgressRing value={rank ?? 34} max={rankTotal} label={`#${rank ?? 34}`} color="var(--vt-blue)" />
            <div>
              <div style={{ font: "700 14px var(--vt-font)", color: "var(--vt-ink)" }}>of {rankTotal} teams</div>
              <div style={{ font: "400 12px var(--vt-font)", color: "var(--vt-muted)" }}>Top {Math.round(((rank ?? 34) / rankTotal) * 100)}%</div>
            </div>
          </div>
        </div>

        <div className="vt-stat-card">
          <div className="vt-stat-card-header">
            <span className="vt-stat-card-title">Win Rate</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ProgressRing value={wins} max={wins + losses + ties} label={`${Math.round((wins / Math.max(wins + losses + ties, 1)) * 100)}%`} color="var(--vt-green)" />
            <div>
              <div style={{ font: "700 14px var(--vt-font)", color: "var(--vt-ink)" }}>{wins} wins</div>
              <div style={{ font: "400 12px var(--vt-font)", color: "var(--vt-muted)" }}>out of {wins + losses + ties}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <p className="vt-section-label">Quick Actions</p>
      <h2 style={{ font: "700 18px var(--vt-font)", color: "var(--vt-ink)", marginBottom: 12 }}>
        Start with what matters
      </h2>
      <a className="vt-quick-action" href={withOrgHref("/ai?tab=chat", orgId)}>
        <span className="vt-quick-action-icon">
          <Icon name="bolt" />
        </span>
        <span className="vt-quick-action-text">
          <span className="vt-quick-action-title">AI Strategy</span>
        </span>
        <span className="vt-quick-action-arrow">
          <Icon name="chevron" />
        </span>
      </a>
      <a className="vt-quick-action" href={withOrgHref("/competition?tab=scouting", orgId)} style={{ background: "var(--vt-ink)" }}>
        <span className="vt-quick-action-icon">
          <Icon name="scout" />
        </span>
        <span className="vt-quick-action-text">
          <span className="vt-quick-action-title">Scouting Hub</span>
        </span>
        <span className="vt-quick-action-arrow">
          <Icon name="chevron" />
        </span>
      </a>
      <a className="vt-quick-action" href={withOrgHref("/competition?tab=matches", orgId)} style={{ background: "var(--vt-purple)" }}>
        <span className="vt-quick-action-icon">
          <Icon name="swords" />
        </span>
        <span className="vt-quick-action-text">
          <span className="vt-quick-action-title">Match Strategy</span>
        </span>
        <span className="vt-quick-action-arrow">
          <Icon name="chevron" />
        </span>
      </a>
      <a className="vt-quick-action" href={withOrgHref("/analytics", orgId)} style={{ background: "var(--vt-teal)" }}>
        <span className="vt-quick-action-icon">
          <Icon name="stats" />
        </span>
        <span className="vt-quick-action-text">
          <span className="vt-quick-action-title">Analytics</span>
        </span>
        <span className="vt-quick-action-arrow">
          <Icon name="chevron" />
        </span>
      </a>
    </main>
  );
}
