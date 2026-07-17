"use client";

import { useEffect, useState } from "react";

type Run = {
  id: string;
  capability: string;
  status: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  sourceCount: number;
  createdAt: string;
  completedAt: string | null;
  actorName: string | null;
  actorEmail: string | null;
  costUsd: string | null;
  totalTokens: number | null;
};

type Step = {
  sequence: number;
  kind: string;
  status: string | null;
  provenance: unknown[];
  createdAt: string;
};

type Artifact = { id: string; kind: string; title: string; version: number; createdAt: string };

type RunDetail = {
  run: Run & { contextSources: unknown[] };
  steps: Step[];
  artifacts: Artifact[];
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

const money = (value: unknown) => (value == null ? "—" : `$${Number(value).toFixed(4)}`);
const label = (map: Record<string, string>, key: string) => map[key] ?? key;
const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "12px",
};

function statusColor(status: string): string | undefined {
  if (status === "error" || status === "failed") return "#ff6b6b";
  if (status === "running") return "#ffb936";
  if (status === "completed") return "#16d9e8";
  return undefined;
}

// Provenance entries are free-form jsonb; show the human-meaningful fields if present.
function describeSource(entry: unknown): string {
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const kind = record.classification ?? record.type ?? record.kind;
    const name = record.source ?? record.label ?? record.name ?? record.tool ?? record.id;
    if (kind || name) return [kind, name].filter(Boolean).join(": ");
    return JSON.stringify(record);
  }
  return String(entry);
}

export default function AiRunsClient({ orgId }: { orgId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [statusCounts, setStatusCounts] = useState<Array<{ status: string; count: string }>>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/agent/runs?orgId=${orgId}`);
      const data = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(data.error ?? "Unable to load run history");
      else {
        setMessage("");
        setRuns(data.runs ?? []);
        setStatusCounts(data.statusCounts ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  async function toggle(runId: string) {
    if (openId === runId) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(runId);
    setDetail(null);
    const response = await fetch(`/api/agent/runs?orgId=${orgId}&runId=${runId}`);
    const data = await response.json();
    if (response.ok) setDetail(data);
    else setMessage(data.error ?? "Unable to load run detail");
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI RUN HISTORY</span>
          <h1>Every assistant run, including the ones that failed</h1>
          <p className="app-muted">
            The orchestrator&apos;s run log — capability, model, status, cost, and the data sources that
            informed each answer. Open a run to see its ordered steps and provenance.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Governance links">
          <a href={`/team/usage?orgId=${orgId}`}>AI usage</a>
          <a href={`/team/ai-memory?orgId=${orgId}`}>AI memory</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading run history…</p>}

      {!loading && !!statusCounts.length && (
        <section className="metric-grid">
          {statusCounts.map((row) => (
            <article key={row.status}>
              <span>{row.status} · 30d</span>
              <strong style={{ color: statusColor(row.status) }}>{Number(row.count).toLocaleString()}</strong>
            </article>
          ))}
        </section>
      )}

      {!loading && (
        <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
          <span className="eyebrow">RECENT RUNS · LAST {runs.length}</span>
          {!runs.length && <p className="app-muted">No assistant runs recorded yet.</p>}
          {runs.map((run) => (
            <div key={run.id}>
              <article style={rowStyle} className="admin-org">
                <div>
                  <strong>
                    {label(FEATURE_LABELS, run.capability)} ·{" "}
                    <span style={{ color: statusColor(run.status) }}>{run.status}</span>
                  </strong>
                  <small>
                    {run.actorName ?? run.actorEmail ?? "Member"}
                    {run.model ? ` · ${run.provider ?? "?"}/${run.model}` : ""} ·{" "}
                    {run.sourceCount} source{run.sourceCount === 1 ? "" : "s"} ·{" "}
                    {new Date(run.createdAt).toLocaleString()}
                    {run.error ? ` · ${run.error}` : ""}
                  </small>
                </div>
                <button type="button" onClick={() => void toggle(run.id)}>
                  {openId === run.id ? "Hide" : "Details"} · {money(run.costUsd)}
                </button>
              </article>
              {openId === run.id && (
                <div className="intel-panel" style={{ margin: "0 0 1rem", background: "#0a1115" }}>
                  {!detail && <p className="app-muted">Loading run detail…</p>}
                  {detail && detail.run.id === run.id && (
                    <>
                      <span className="eyebrow">CONTEXT SOURCES (PROVENANCE)</span>
                      {!detail.run.contextSources?.length && (
                        <p className="app-muted">No context sources recorded for this run.</p>
                      )}
                      {(detail.run.contextSources ?? []).map((source, index) => (
                        <p key={index} className="app-muted" style={{ margin: "4px 0" }}>
                          · {describeSource(source)}
                        </p>
                      ))}
                      {!!detail.steps.length && (
                        <>
                          <span className="eyebrow" style={{ display: "block", marginTop: "1rem" }}>
                            STEPS
                          </span>
                          {detail.steps.map((step) => (
                            <p key={step.sequence} className="app-muted" style={{ margin: "4px 0" }}>
                              {step.sequence}. {step.kind}
                              {step.status ? ` · ${step.status}` : ""}
                              {step.provenance?.length ? ` · ${step.provenance.length} provenance` : ""}
                            </p>
                          ))}
                        </>
                      )}
                      {!!detail.artifacts.length && (
                        <>
                          <span className="eyebrow" style={{ display: "block", marginTop: "1rem" }}>
                            ARTIFACTS
                          </span>
                          {detail.artifacts.map((artifact) => (
                            <p key={artifact.id} className="app-muted" style={{ margin: "4px 0" }}>
                              · {artifact.kind}: {artifact.title} (v{artifact.version})
                            </p>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
