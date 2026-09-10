"use client";

import { useEffect, useState } from "react";

type Policy = {
  enabled: boolean;
  sponsoredModelId: string | null;
  sponsoredModel: string | null;
  monthlyAllowanceUsd: string;
  orgDailyLimit: number;
  userDailyLimit: number;
  ipDailyLimit: number;
  concurrencyLimit: number;
  requireVerifiedEmail: boolean;
  requireClosedTeam: boolean;
  updatedAt: string | null;
};

type Economics = {
  sponsored_provider_cost_usd: string;
  sponsored_completed_requests: string;
  sponsored_denied_requests: string;
  sponsored_active_orgs: string;
  free_orgs: string;
  converted_paid_orgs: string;
};

type Usage = {
  id: string;
  createdAt: string;
  status: string;
  denialReason: string | null;
  providerCostUsd: string;
  orgName: string | null;
  teamNumber: number | null;
  model: string | null;
};

const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
const num = (value: unknown) => Number(value ?? 0).toLocaleString();

function statusColor(status: string): string | undefined {
  if (status === "denied" || status === "failed") return "#ff6b6b";
  if (status === "completed") return "#16d9e8";
  return undefined;
}

export default function SponsoredClient() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [economics, setEconomics] = useState<Economics | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [byOutcome, setByOutcome] = useState<Array<{ status: string; denialReason: string | null; count: string }>>([]);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/admin/sponsored");
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Unable to load sponsored AI");
      setOk(false);
    } else {
      setPolicy(data.policy);
      setEconomics(data.economics);
      setUsage(data.recentUsage ?? []);
      setByOutcome(data.byOutcome ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function setEnabled(enabled: boolean) {
    if (enabled && !confirm("Enable sponsored/free AI platform-wide?")) return;
    if (!enabled && !confirm("Disable sponsored AI now? Free-tier orgs will stop getting sponsored calls.")) return;
    const response = await fetch("/api/admin/sponsored", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();
    setOk(response.ok);
    setMessage(
      response.ok
        ? `Sponsored AI ${enabled ? "enabled" : "disabled"} and audited.`
        : data.error ?? "Update failed",
    );
    if (response.ok) await load();
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / SPONSORED AI GOVERNANCE</span>
          <h1>Free-tier AI economics &amp; abuse controls</h1>
          <p className="app-muted">
            What the platform spends sponsoring free-tier AI, the guardrails on it, and every recent sponsored
            call — including denied and failed ones and why.
          </p>
        </div>
        <a href="/admin/models">Model routing →</a>
      </header>

      {message && <p className={`telemetry-status${ok ? " success" : ""}`}>{message}</p>}
      {loading && <p className="app-muted">Loading sponsored AI…</p>}

      {!loading && economics && (
        <section className="metric-grid">
          <article>
            <span>Sponsored cost · MTD</span>
            <strong>{money(economics.sponsored_provider_cost_usd)}</strong>
          </article>
          <article>
            <span>Completed</span>
            <strong>{num(economics.sponsored_completed_requests)}</strong>
          </article>
          <article>
            <span>Denied</span>
            <strong style={{ color: "#ff6b6b" }}>{num(economics.sponsored_denied_requests)}</strong>
          </article>
          <article>
            <span>Active free orgs</span>
            <strong>{num(economics.sponsored_active_orgs)}</strong>
          </article>
          <article>
            <span>Free orgs</span>
            <strong>{num(economics.free_orgs)}</strong>
          </article>
          <article>
            <span>Converted to paid</span>
            <strong>{num(economics.converted_paid_orgs)}</strong>
          </article>
        </section>
      )}

      {!loading && policy && (
        <section className="admin-grid">
          <section className="intel-panel">
            <span className="eyebrow">SPONSORED AI POLICY</span>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              Status:{" "}
              <strong style={{ color: policy.enabled ? "#16d9e8" : "#ffb936" }}>
                {policy.enabled ? "Enabled" : "Disabled"}
              </strong>
              <br />
              Sponsored model: <strong>{policy.sponsoredModel ?? "not set"}</strong>
              <br />
              Monthly allowance: <strong>{money(policy.monthlyAllowanceUsd)}</strong>
              <br />
              Daily limits — org <strong>{policy.orgDailyLimit}</strong>, user{" "}
              <strong>{policy.userDailyLimit}</strong>, IP <strong>{policy.ipDailyLimit}</strong>
              <br />
              Concurrency: <strong>{policy.concurrencyLimit}</strong>
              <br />
              Requires verified email: <strong>{policy.requireVerifiedEmail ? "yes" : "no"}</strong> · closed-team
              member: <strong>{policy.requireClosedTeam ? "yes" : "no"}</strong>
            </p>
            <div className="intel-actions" style={{ marginTop: "1rem" }}>
              {policy.enabled ? (
                <button type="button" className="danger-action" onClick={() => void setEnabled(false)}>
                  Pause sponsored AI
                </button>
              ) : (
                <button type="button" onClick={() => void setEnabled(true)}>
                  Enable sponsored AI
                </button>
              )}
            </div>
            {!policy.sponsoredModelId && (
              <p className="app-muted" style={{ marginTop: "0.5rem" }}>
                Configure a sponsored model and allowance on the{" "}
                <a href="/admin/models">Models</a> page before enabling.
              </p>
            )}
          </section>
          <section className="intel-panel">
            <span className="eyebrow">OUTCOMES · LAST 30D</span>
            {!byOutcome.length && <p className="app-muted">No sponsored calls in this window.</p>}
            {byOutcome.map((row, index) => (
              <article
                className="admin-org"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
                key={index}
              >
                <div>
                  <strong style={{ color: statusColor(row.status) }}>{row.status}</strong>
                  <small>{row.denialReason ?? "—"}</small>
                </div>
                <b>{num(row.count)}</b>
              </article>
            ))}
          </section>
        </section>
      )}

      {!loading && (
        <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
          <span className="eyebrow">RECENT SPONSORED CALLS · LAST {usage.length}</span>
          {!usage.length && <p className="app-muted">No sponsored calls recorded yet.</p>}
          {usage.map((row) => (
            <article
              className="admin-org"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}
              key={row.id}
            >
              <div>
                <strong style={{ color: statusColor(row.status) }}>
                  {row.status}
                  {row.denialReason ? ` · ${row.denialReason}` : ""}
                </strong>
                <small>
                  {row.teamNumber ? `#${row.teamNumber} ` : ""}
                  {row.orgName ?? "Unknown org"}
                  {row.model ? ` · ${row.model}` : ""} · {new Date(row.createdAt).toLocaleString()}
                </small>
              </div>
              <b>{money(row.providerCostUsd)}</b>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
