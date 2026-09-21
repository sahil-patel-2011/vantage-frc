"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../components/icon";

/**
 * Mobile-first admin page redesign matching the design mockup.
 * Shows sync status, metrics, and most-used admin cards.
 */

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string | null;
};

export function AdminRedesign() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("workspace");

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/admin/organizations");
        if (response.ok) {
          const data = await response.json();
          setOrgs(Array.isArray(data.organizations) ? data.organizations : []);
        }
      } catch {
        // best-effort
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const tabs = ["Workspace", "Data", "Operations", "Settings"];

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <main className="vt-page" id="main-content">
      <h1 className="vt-page-title">Admin</h1>
      <p className="vt-page-subtitle">People, data, sync, permissions, and workspace controls</p>

      {/* Tab Bar */}
      <div className="vt-admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className="vt-admin-tab"
            data-active={activeTab === tab.toLowerCase()}
            onClick={() => setActiveTab(tab.toLowerCase())}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Sync Status Card */}
      <div className="vt-card" style={{ marginBottom: 24 }}>
        <div className="vt-flex vt-items-center vt-justify-between vt-mb-4">
          <h2 style={{ font: "700 16px var(--vt-font)", color: "var(--vt-ink)" }}>Sync Status</h2>
          <a
            href="/admin/analytics"
            style={{
              font: "600 12px var(--vt-font)",
              color: "var(--vt-blue)",
              textDecoration: "none",
            }}
          >
            Usage Report &rsaquo;
          </a>
        </div>

        {/* TBA Last Sync */}
        <div className="vt-sync-row">
          <div className="vt-sync-icon" style={{ background: "var(--vt-green-soft)", color: "var(--vt-green)" }}>
            <Icon name="globe" />
          </div>
          <div className="vt-sync-info">
            <div className="vt-sync-title">TBA Last Sync</div>
            <div className="vt-sync-subtitle">2 minutes ago · {timeStr}</div>
          </div>
          <span className="vt-sync-badge live">Live</span>
        </div>

        {/* Event */}
        <div className="vt-sync-row">
          <div className="vt-sync-icon" style={{ background: "var(--vt-blue-soft)", color: "var(--vt-blue)" }}>
            <Icon name="pin" />
          </div>
          <div className="vt-sync-info">
            <div className="vt-sync-title">Peachtree District Championship</div>
            <div className="vt-sync-subtitle">Macon</div>
          </div>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--vt-green)", flex: "none" }} />
        </div>

        {/* Metrics */}
        <div className="vt-metrics">
          <div className="vt-metric">
            <div className="vt-metric-value" style={{ color: "var(--vt-blue)" }}>
              {loading ? "—" : orgs.length || 95}
            </div>
            <div className="vt-metric-label">Teams</div>
          </div>
          <div className="vt-metric">
            <div className="vt-metric-value" style={{ color: "var(--vt-purple)" }}>437/500</div>
            <div className="vt-metric-label">Matches</div>
          </div>
          <div className="vt-metric">
            <div className="vt-metric-value" style={{ color: "var(--vt-green)" }}>63</div>
            <div className="vt-metric-label">Remaining</div>
          </div>
        </div>

        {/* AI Usage */}
        <div className="vt-sync-row">
          <div className="vt-sync-icon" style={{ background: "var(--vt-red-soft)", color: "var(--vt-red)" }}>
            <Icon name="bolt" />
          </div>
          <div className="vt-sync-info">
            <div className="vt-sync-title">AI Usage</div>
            <div className="vt-sync-subtitle">0 sync runs today · No sync activity yet</div>
          </div>
          <span style={{ font: "700 16px var(--vt-font)", color: "var(--vt-red)" }}>86</span>
        </div>
      </div>

      {/* Most Used */}
      <p className="vt-section-label">Most Used</p>
      <div className="vt-admin-grid">
        <a className="vt-admin-card" href="/admin">
          <div className="vt-admin-card-icon" style={{ background: "var(--vt-blue-soft)", color: "var(--vt-blue)" }}>
            <Icon name="users" />
          </div>
          <div className="vt-admin-card-text">
            <div className="vt-admin-card-title">People</div>
            <div className="vt-admin-card-sub">Roles, access, invites</div>
          </div>
          <Icon name="chevron" />
        </a>
        <a className="vt-admin-card" href="/admin">
          <div className="vt-admin-card-icon" style={{ background: "var(--vt-amber-soft)", color: "var(--vt-amber)" }}>
            <Icon name="clipboard" />
          </div>
          <div className="vt-admin-card-text">
            <div className="vt-admin-card-title">Tasks</div>
            <div className="vt-admin-card-sub">Assign and track work</div>
          </div>
          <Icon name="chevron" />
        </a>
        <a className="vt-admin-card" href="/admin">
          <div className="vt-admin-card-icon" style={{ background: "var(--vt-purple-soft)", color: "var(--vt-purple)" }}>
            <Icon name="calendar" />
          </div>
          <div className="vt-admin-card-text">
            <div className="vt-admin-card-title">Matches</div>
            <div className="vt-admin-card-sub">Schedule and results</div>
          </div>
          <Icon name="chevron" />
        </a>
        <a className="vt-admin-card" href="/admin">
          <div className="vt-admin-card-icon" style={{ background: "var(--vt-green-soft)", color: "var(--vt-green)" }}>
            <Icon name="shield" />
          </div>
          <div className="vt-admin-card-text">
            <div className="vt-admin-card-title">Security</div>
            <div className="vt-admin-card-sub">Audit and access logs</div>
          </div>
          <Icon name="chevron" />
        </a>
      </div>
    </main>
  );
}
