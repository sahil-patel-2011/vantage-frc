"use client";

import { useState } from "react";
import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { Me } from "../../components/app-shell-model";
import { DonutChart, BarChart, ProgressRing } from "./dashboard-charts";
import { ScoutingFilterBar, type ScoutingData } from "./scouting-filter";

/**
 * Card layout for event status. Numbers render only when a widget
 * actually supplied them — a missing rank stays blank.
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
  return me.email?.split("@")[0] || "there";
}

export function DashboardRedesign({
  me,
  orgId,
  eventName,
  widgets,
}: {
  me: Me;
  orgId: string;
  eventName: unknown;
  widgets: Record<string, unknown>;
}) {
  const [syncing, setSyncing] = useState(false);
  const name = formatName(me);
  const event = typeof eventName === "string" && eventName ? eventName : null;

  // Extract widget data safely
  const rankWidget = widgets?.rank as { rank?: number; total?: number } | undefined;
  const recordWidget = widgets?.record as { wins?: number; losses?: number; ties?: number } | undefined;
  const pointsWidget = widgets?.points as { value?: number } | undefined;
  const epaWidget = widgets?.epa as { auto?: number; teleop?: number; end?: number; total?: number } | undefined;
  const streakWidget = widgets?.streak as { count?: number; type?: string } | undefined;
  const scoutingWidget = widgets?.scouting_coverage as { assignments?: number; reports?: number; openDisagreements?: number } | undefined;
  const teamNumber = me.teamNumber || null;

  const rank = typeof rankWidget?.rank === "number" ? rankWidget.rank : null;
  const rankTotal = typeof rankWidget?.total === "number" ? rankWidget.total : null;
  const wins = typeof recordWidget?.wins === "number" ? recordWidget.wins : null;
  const losses = typeof recordWidget?.losses === "number" ? recordWidget.losses : null;
  const ties = typeof recordWidget?.ties === "number" ? recordWidget.ties : 0;
  const points = typeof pointsWidget?.value === "number" ? pointsWidget.value : null;
  const epaAuto = typeof epaWidget?.auto === "number" ? epaWidget.auto : null;
  const epaTeleop = typeof epaWidget?.teleop === "number" ? epaWidget.teleop : null;
  const epaEnd = typeof epaWidget?.end === "number" ? epaWidget.end : null;
  const epaTotal = typeof epaWidget?.total === "number" ? epaWidget.total : null;
  const streakCount = typeof streakWidget?.count === "number" ? streakWidget.count : 0;
  const streakType = typeof streakWidget?.type === "string" ? streakWidget.type : "";
  const scoutingData: ScoutingData | null = scoutingWidget
    ? {
        assignments: scoutingWidget.assignments ?? 0,
        reports: scoutingWidget.reports ?? 0,
        openDisagreements: scoutingWidget.openDisagreements ?? 0,
      }
    : null;
  const hasRecord = wins != null && losses != null;

  const epa = (() => {
    if (epaAuto == null || epaTeleop == null || epaEnd == null) return null;
    const sum = epaAuto + epaTeleop + epaEnd || 1;
    return {
      autoPct: (epaAuto / sum) * 100,
      teleopPct: (epaTeleop / sum) * 100,
      endPct: (epaEnd / sum) * 100,
      auto: epaAuto,
      teleop: epaTeleop,
      end: epaEnd,
      total: epaTotal ?? epaAuto + epaTeleop + epaEnd,
    };
  })();
  const hasSnapshot = rank != null || hasRecord || points != null;

  function handleRefresh() {
    setSyncing(true);
    window.location.reload();
  }

  return (
    <main className="vt-page vt-redesign" id="main-content">
      {/* Welcome Card */}
      <div className="vt-welcome">
        <div className="vt-flex vt-items-center vt-justify-between">
          <div>
            <h1 className="vt-welcome-greeting">{greeting()}, {name}</h1>
          </div>
          <button className="vt-sync-btn" type="button" onClick={handleRefresh} disabled={syncing}>
            {syncing ? "Refreshing" : "Refresh"}
          </button>
        </div>
        {teamNumber ? <div className="vt-welcome-number">{teamNumber}</div> : null}
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

      <p className="vt-section-label">Competition Snapshot</p>
      {hasSnapshot ? (
      <div className="vt-card" style={{ marginBottom: 24 }}>
        <div className="vt-snapshot">
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value">{rank != null ? `#${rank}` : "—"}</div>
            <div className="vt-snapshot-label">{rank != null && rankTotal != null ? `Rank · ${rank} of ${rankTotal}` : "Rank"}</div>
          </div>
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value">{hasRecord ? `${wins}-${losses}${ties > 0 ? `-${ties}` : ""}` : "—"}</div>
            <div className="vt-snapshot-label">Current event record</div>
          </div>
          <div className="vt-snapshot-col">
            <div className="vt-snapshot-value blue">{points ?? "—"}</div>
            <div className="vt-snapshot-label">Points per match</div>
          </div>
        </div>

        {epa ? (
        <div className="vt-epa-bar">
          <div className="vt-epa-header">
            <span className="vt-epa-label">EPA Rating</span>
            <span className="vt-epa-tag">Statbotics Event</span>
          </div>
          <div className="vt-epa-track">
            <div className="vt-epa-segment" style={{ width: `${epa.autoPct}%`, background: "var(--vt-teal)" }} />
            <div className="vt-epa-segment" style={{ width: `${epa.teleopPct}%`, background: "var(--vt-purple)" }} />
            <div className="vt-epa-segment" style={{ width: `${epa.endPct}%`, background: "var(--vt-orange)" }} />
          </div>
          <div className="vt-epa-legend">
            <div className="vt-epa-legend-items">
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-teal)" }} /> Auto {epa.auto}
              </span>
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-purple)" }} /> Teleop {epa.teleop}
              </span>
              <span className="vt-epa-legend-item">
                <span className="vt-epa-legend-dot" style={{ background: "var(--vt-orange)" }} /> End {epa.end}
              </span>
            </div>
            <span className="vt-epa-value">{epa.total}</span>
          </div>
        </div>
        ) : null}
      </div>
      ) : (
        <div className="vt-card" style={{ marginBottom: 24 }}>
          <p className="vt-welcome-helper">Rank, record, and points show up here once this event is connected.</p>
          <a className="vt-welcome-event" href={withOrgHref("/competition", orgId)}>
            <span>Open competition</span>
            <Icon name="chevron" />
          </a>
        </div>
      )}

      {(hasRecord || epa) ? (
      <>
      <p className="vt-section-label">Performance</p>

      {/* Win-Loss Donut + EPA Bar */}
      <div className="vt-chart-grid" style={{ marginBottom: 16 }}>
        {wins != null && losses != null ? (
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
        ) : null}

        {epa ? (
        <div className="vt-card">
          <div className="vt-stat-card-header" style={{ marginBottom: 12 }}>
            <span className="vt-stat-card-title">EPA Breakdown</span>
            <span className="vt-stat-card-badge">Total {epa.total}</span>
          </div>
          <BarChart
            data={[
              { label: "Auto", value: epa.auto, color: "var(--vt-teal)" },
              { label: "Teleop", value: epa.teleop, color: "var(--vt-purple)" },
              { label: "Endgame", value: epa.end, color: "var(--vt-orange)" },
            ]}
            formatValue={(v) => v.toFixed(1)}
          />
        </div>
        ) : null}
      </div>

      <div className="vt-chart-grid" style={{ marginBottom: 16 }}>
        {rank != null && rankTotal != null && rankTotal > 0 ? (
        <div className="vt-stat-card">
          <div className="vt-stat-card-header">
            <span className="vt-stat-card-title">Place in the field</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ProgressRing value={rankTotal - rank + 1} max={rankTotal} label={`#${rank}`} color="var(--vt-blue)" />
            <div>
              <div style={{ font: "700 14px var(--vt-font)", color: "var(--vt-ink)" }}>of {rankTotal} teams</div>
              <div style={{ font: "400 12px var(--vt-font)", color: "var(--vt-muted)" }}>Top {Math.max(1, Math.round((rank / rankTotal) * 100))}%</div>
            </div>
          </div>
        </div>
        ) : null}

        {wins != null && losses != null ? (
        <div className="vt-stat-card">
          <div className="vt-stat-card-header">
            <span className="vt-stat-card-title">Win Rate</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ProgressRing value={wins} max={Math.max(wins + losses + ties, 1)} label={`${Math.round((wins / Math.max(wins + losses + ties, 1)) * 100)}%`} color="var(--vt-green)" />
            <div>
              <div style={{ font: "700 14px var(--vt-font)", color: "var(--vt-ink)" }}>{wins} wins</div>
              <div style={{ font: "400 12px var(--vt-font)", color: "var(--vt-muted)" }}>out of {wins + losses + ties}</div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
      </>
      ) : null}

      {scoutingData ? (
      <>
      <p className="vt-section-label">Scouting Coverage</p>
      <div className="vt-card" style={{ marginBottom: 16 }}>
        <ScoutingFilterBar data={scoutingData}>
          {(filtered) => (
            <div className="vt-snapshot" style={{ marginTop: 4 }}>
              <div className="vt-snapshot-col">
                <div className="vt-snapshot-value">{filtered.assignments}</div>
                <div className="vt-snapshot-label">Assignments</div>
              </div>
              <div className="vt-snapshot-col">
                <div className="vt-snapshot-value blue">{filtered.reports}</div>
                <div className="vt-snapshot-label">Reports Filed</div>
              </div>
              <div className="vt-snapshot-col">
                <div className="vt-snapshot-value" style={{ color: filtered.openDisagreements > 0 ? "var(--vt-amber)" : "var(--vt-green)" }}>{filtered.openDisagreements}</div>
                <div className="vt-snapshot-label">Open Disputes</div>
              </div>
            </div>
          )}
        </ScoutingFilterBar>
      </div>
      </>
      ) : null}

      <p className="vt-section-label">Quick Actions</p>
      <h2 style={{ font: "700 18px var(--vt-font)", color: "var(--vt-ink)", marginBottom: 12 }}>
        Start with what matters
      </h2>
      <div className="vt-quick-grid">
        <a className="vt-quick-action quiet" href={withOrgHref("/ai?tab=chat", orgId)}>
          <span className="vt-quick-action-icon"><Icon name="bolt" /></span>
          <span className="vt-quick-action-text">
            <span className="vt-quick-action-title">Ask AI</span>
            <span className="vt-quick-action-sub">A match, a robot, or a rule</span>
          </span>
          <span className="vt-quick-action-arrow"><Icon name="chevron" /></span>
        </a>
        <a className="vt-quick-action quiet" href={withOrgHref("/competition?tab=scouting", orgId)}>
          <span className="vt-quick-action-icon"><Icon name="scout" /></span>
          <span className="vt-quick-action-text">
            <span className="vt-quick-action-title">Scout</span>
            <span className="vt-quick-action-sub">Log a report or check coverage</span>
          </span>
          <span className="vt-quick-action-arrow"><Icon name="chevron" /></span>
        </a>
        <a className="vt-quick-action quiet" href={withOrgHref("/competition?tab=matches", orgId)}>
          <span className="vt-quick-action-icon"><Icon name="swords" /></span>
          <span className="vt-quick-action-text">
            <span className="vt-quick-action-title">Matches</span>
            <span className="vt-quick-action-sub">Lineup and notes for the next one</span>
          </span>
          <span className="vt-quick-action-arrow"><Icon name="chevron" /></span>
        </a>
        <a className="vt-quick-action quiet" href={withOrgHref("/analytics", orgId)}>
          <span className="vt-quick-action-icon"><Icon name="stats" /></span>
          <span className="vt-quick-action-text">
            <span className="vt-quick-action-title">Analytics</span>
            <span className="vt-quick-action-sub">Rank, EPA, and trends</span>
          </span>
          <span className="vt-quick-action-arrow"><Icon name="chevron" /></span>
        </a>
      </div>
    </main>
  );
}
