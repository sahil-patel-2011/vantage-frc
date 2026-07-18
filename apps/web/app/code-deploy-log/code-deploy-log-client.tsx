"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { deployStatusLabel, deployTypeLabel } from "../../lib/code-deploy-log";
import {
  DEPLOY_STATUSES,
  DEPLOY_TYPES,
  type CodeDeployLogView,
} from "../../lib/code-deploy-log/compute-code-deploy-log";
import type { DeployStatus, DeployType } from "../../lib/code-deploy-log/types";

function statusTone(status: DeployStatus): string {
  if (status === "deployed") return "good";
  if (status === "rolled_back") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<CodeDeployLogView, { status: "live" }>;

export default function CodeDeployLogClient() {
  const [view, setView] = useState<CodeDeployLogView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/code-deploy-log${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CodeDeployLogView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/code-deploy-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as CodeDeployLogView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Code Deploy Log"}
          </>
        }
        title="Code Deploy Log"
        description="Track which firmware/software build ran during which match or test session — the evidence trail for 'what code was running during qm42'."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the code deploy log"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <LogDeployForm busy={busy} mutate={mutate} />
          <RecentDeploys view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Deploys", value: String(summary.totalDeploys) },
    { label: "Match-linked", value: String(summary.matchLinkedDeploys) },
    { label: "Rollback rate", value: pct(summary.rollbackRate) },
    { label: "Last deploy", value: summary.lastDeployedOn ?? "—" },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.byStatus.length > 0 ? (
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          {summary.byStatus.map((row) => (
            <span key={row.status} className={`app-badge ${statusTone(row.status)}`}>
              {deployStatusLabel(row.status)}: {row.count}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function RecentDeploys({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalDeploys === 0) {
    return (
      <EmptyState
        badge="No deploys yet"
        badgeTone="setup"
        title="Log your first code deploy"
        description="Record the firmware version, commit, and match tied to each deploy so you can trace robot behavior back to code."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Deploy history</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 30).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.firmwareVersion}</strong>{" "}
              <span className={`app-badge ${statusTone(item.status)}`}>{deployStatusLabel(item.status)}</span>
              <small className="app-muted" style={{ display: "block" }}>
                {item.deployedOn} · {deployTypeLabel(item.deployType)}
                {item.matchKey ? ` · ${item.matchKey}` : ""}
                {item.branch ? ` · ${item.branch}` : ""}
                {item.commitSha ? ` · ${item.commitSha}` : ""}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete deploy "${item.firmwareVersion}"?`)) {
                  mutate({ action: "delete-deploy", entryId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogDeployForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      deployedOn: "",
      firmwareVersion: "",
      matchKey: "",
      eventKey: "",
      commitSha: "",
      branch: "",
      deployType: "practice" as DeployType,
      status: "deployed" as DeployStatus,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.deployedOn || !form.firmwareVersion.trim()) return;
        mutate({
          action: "log-deploy",
          deployedOn: form.deployedOn,
          firmwareVersion: form.firmwareVersion,
          matchKey: form.matchKey || undefined,
          eventKey: form.eventKey || undefined,
          commitSha: form.commitSha || undefined,
          branch: form.branch || undefined,
          deployType: form.deployType,
          status: form.status,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log deploy</h2>
      <FormGrid min={160}>
        <FormRow label="Date">
          <input type="date" value={form.deployedOn} onChange={set("deployedOn")} required />
        </FormRow>
        <FormRow label="Firmware / build version">
          <input value={form.firmwareVersion} onChange={set("firmwareVersion")} placeholder="v1.4.0" required />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026miket_qm10" />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
        <FormRow label="Commit SHA (optional)">
          <input value={form.commitSha} onChange={set("commitSha")} placeholder="abc1234" />
        </FormRow>
        <FormRow label="Branch (optional)">
          <input value={form.branch} onChange={set("branch")} placeholder="main" />
        </FormRow>
        <FormRow label="Deploy type">
          <select value={form.deployType} onChange={set("deployType")}>
            {DEPLOY_TYPES.map((deployType) => (
              <option key={deployType} value={deployType}>
                {deployTypeLabel(deployType)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {DEPLOY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {deployStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.deployedOn || !form.firmwareVersion.trim()}
        >
          Log deploy
        </button>
      </div>
    </Panel>
  );
}
