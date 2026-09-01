"use client";

import { useEffect, useState } from "react";

type IntegrationState = "healthy" | "configured" | "degraded" | "setup_required" | "error";

type IntegrationCheck = {
  id: string;
  category: string;
  label: string;
  state: IntegrationState;
  verification: "live" | "config_only";
  reason: string;
  lastSuccessAt: string | null;
  remediation: { label: string; href: string } | null;
};

type IntegrationHealthReport = {
  generatedAt: string;
  summary: Record<IntegrationState, number>;
  checks: IntegrationCheck[];
};

const STATE_BADGE: Record<IntegrationState, { tone: string; label: string }> = {
  healthy: { tone: "app-badge good", label: "Healthy" },
  configured: { tone: "app-badge", label: "Configured" },
  degraded: { tone: "app-badge demo", label: "Degraded" },
  setup_required: { tone: "app-badge setup", label: "Setup required" },
  error: { tone: "app-badge setup", label: "Error" },
};

function groupByCategory(checks: IntegrationCheck[]): Array<{ category: string; checks: IntegrationCheck[] }> {
  const order: string[] = [];
  const byCategory = new Map<string, IntegrationCheck[]>();
  for (const check of checks) {
    if (!byCategory.has(check.category)) {
      byCategory.set(check.category, []);
      order.push(check.category);
    }
    byCategory.get(check.category)!.push(check);
  }
  return order.map((category) => ({ category, checks: byCategory.get(category)! }));
}

export default function IntegrationsClient() {
  const [report, setReport] = useState<IntegrationHealthReport | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch("/api/admin/integration-health");
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load integration health");
      else {
        setMessage("");
        setReport(data as IntegrationHealthReport);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const groups = report ? groupByCategory(report.checks) : [];

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / PLATFORM INTEGRATIONS</span>
          <h1>Integration health</h1>
          <p className="app-muted">
            Configuration + already-persisted live signals for every external dependency — never a secret value,
            never a live provider call on page load. Bounded test actions live on each integration&apos;s own admin
            page (Connectors, Model control).
          </p>
        </div>
        <a href="/admin/connectors">Data connectors →</a>
      </header>

      {message && <p className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading integration health…</p>}

      {report && (
        <div className="tag-row" style={{ margin: "1rem 0" }}>
          <span>Healthy · {report.summary.healthy}</span>
          <span>Configured · {report.summary.configured}</span>
          <span>Degraded · {report.summary.degraded}</span>
          <span>Setup required · {report.summary.setup_required}</span>
          <span>Error · {report.summary.error}</span>
        </div>
      )}

      {groups.map((group) => (
        <section className="intel-panel" style={{ marginBottom: 16 }} key={group.category}>
          <span className="eyebrow">{group.category.toUpperCase()}</span>
          {group.checks.map((check) => (
            <article
              className="admin-org"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
              key={check.id}
            >
              <div style={{ minWidth: 0 }}>
                <strong>{check.label}</strong>
                <br />
                <small>{check.reason}</small>
                {check.lastSuccessAt && (
                  <>
                    <br />
                    <small className="app-muted">Last success: {new Date(check.lastSuccessAt).toLocaleString()}</small>
                  </>
                )}
              </div>
              <div style={{ display: "grid", justifyItems: "end", gap: 4, flexShrink: 0 }}>
                <span className={STATE_BADGE[check.state].tone}>{STATE_BADGE[check.state].label}</span>
                <small className="app-muted">{check.verification === "live" ? "live signal" : "config only"}</small>
                {check.remediation && <a href={check.remediation.href}>{check.remediation.label}</a>}
              </div>
            </article>
          ))}
        </section>
      ))}

      {report && groups.length === 0 && <p className="app-muted">No integration checks reported.</p>}
    </main>
  );
}
