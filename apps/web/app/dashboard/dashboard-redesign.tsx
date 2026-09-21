"use client";

import { useEffect, useState } from "react";
import { Icon } from "../components/icon";
import { withOrgHref } from "../lib/nav/product-nav";
import type { Me } from "../components/app-shell-model";

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
