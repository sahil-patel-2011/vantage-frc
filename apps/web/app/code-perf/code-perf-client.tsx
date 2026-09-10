"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { CHANGE_TYPES, SUBSYSTEMS, changeTypeLabel, subsystemLabel, verdictLabel } from "../../lib/code-perf";
import type { CodePerfView } from "../../lib/code-perf/compute-code-perf";
import type { ChangeType, CorrelationVerdict, Subsystem } from "../../lib/code-perf/types";

function verdictTone(verdict: CorrelationVerdict): string {
  if (verdict === "improved") return "good";
  if (verdict === "regressed") return "demo";
  if (verdict === "neutral") return "setup";
  return "setup";
}

type LiveView = Extract<CodePerfView, { status: "live" }>;

export default function CodePerfClient() {
  const [view, setView] = useState<CodePerfView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
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
    void fetch(`/api/code-perf${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CodePerfView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => {
        setLoadStatus(null);
        setLoadError("");
        setFetchFailed(true);
      });
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
        const response = await fetch("/api/code-perf", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as CodePerfView | { error?: string };
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
            {" / Code-vs-Match Detective"}
          </>
        }
        title="Code-vs-Match Detective"
        description="Log commits, software-version bumps, and tuning changes alongside match auto/teleop points — see whether a change actually moved on-field performance."
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
        (() => {
          const kind = classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
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
          <LogChangeForm busy={busy} mutate={mutate} />
          <LogMatchResultForm busy={busy} mutate={mutate} />
          <ChangesList view={view} busy={busy} mutate={mutate} />
          <MatchResultsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Changes logged", value: String(summary.totalChanges) },
    { label: "Analyzed", value: String(summary.analyzedChanges) },
    { label: "Improved", value: String(summary.improved) },
    { label: "Regressed", value: String(summary.regressed) },
    { label: "Match results", value: String(summary.totalMatches) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.bySubsystem.length > 0 ? (
        <ul
          className="factor-table"
          style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 6 }}
        >
          {summary.bySubsystem.map((row) => (
            <li key={row.subsystem} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{subsystemLabel(row.subsystem)}</span>
              <small className="app-muted">
                {row.changes} change(s) · {row.improved} improved · {row.regressed} regressed
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function ChangesList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.changes.length === 0) {
    return (
      <EmptyState
        badge="No changes yet"
        badgeTone="setup"
        title="Log your first commit, version bump, or tuning change"
        description="Once you log match results too, you can analyze whether a change actually improved on-field performance."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Logged changes</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.changes.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${verdictTone(item.verdict)}`}>{verdictLabel(item.verdict)}</span>
              <strong style={{ display: "block", marginTop: 4 }}>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.occurredOn} · {changeTypeLabel(item.changeType)} · {subsystemLabel(item.subsystem)}
                {item.commitSha ? ` · ${item.commitSha}` : ""}
              </small>
              {item.analyzedAt ? (
                <small className="app-muted" style={{ display: "block" }}>
                  {item.rationale}
                </small>
              ) : (
                <small className="app-muted" style={{ display: "block" }}>
                  Not analyzed yet.
                </small>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => mutate({ action: "analyze-change", changeId: item.id })}
              >
                Analyze
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${item.title}"?`)) {
                    mutate({ action: "delete-change", changeId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MatchResultsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.matches.length === 0) {
    return (
      <EmptyState
        badge="No match results yet"
        badgeTone="setup"
        title="Log auto/teleop points from your matches"
        description="Match results are the ground truth the detective correlates changes against."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Match results</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.matches.slice(0, 30).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.matchKey}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.occurredOn}
                {item.eventKey ? ` · ${item.eventKey}` : ""} · auto {item.autoPoints} · teleop {item.teleopPoints} ·
                endgame {item.endgamePoints} · total {item.totalPoints}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.matchKey}"?`)) {
                  mutate({ action: "delete-match-result", matchResultId: item.id });
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

function LogChangeForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      occurredOn: "",
      changeType: "commit" as ChangeType,
      subsystem: "general" as Subsystem,
      commitSha: "",
      repoUrl: "",
      description: "",
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
        if (!form.title.trim() || !form.occurredOn) return;
        mutate({
          action: "log-change",
          title: form.title,
          occurredOn: form.occurredOn,
          changeType: form.changeType,
          subsystem: form.subsystem,
          commitSha: form.commitSha || undefined,
          repoUrl: form.repoUrl || undefined,
          description: form.description || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a code/tuning change</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Retune shooter PID" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
        <FormRow label="Type">
          <select value={form.changeType} onChange={set("changeType")}>
            {CHANGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {changeTypeLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem">
          <select value={form.subsystem} onChange={set("subsystem")}>
            {SUBSYSTEMS.map((subsystem) => (
              <option key={subsystem} value={subsystem}>
                {subsystemLabel(subsystem)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Commit SHA (optional)">
          <input value={form.commitSha} onChange={set("commitSha")} placeholder="abc1234" />
        </FormRow>
        <FormRow label="Repo URL (optional)">
          <input value={form.repoUrl} onChange={set("repoUrl")} placeholder="https://github.com/team/robot-code" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.occurredOn}>
          Log change
        </button>
      </div>
    </Panel>
  );
}

function LogMatchResultForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      matchKey: "",
      occurredOn: "",
      eventKey: "",
      autoPoints: "",
      teleopPoints: "",
      endgamePoints: "",
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
        if (!form.matchKey.trim() || !form.occurredOn) return;
        mutate({
          action: "log-match-result",
          matchKey: form.matchKey,
          occurredOn: form.occurredOn,
          eventKey: form.eventKey || undefined,
          autoPoints: Number(form.autoPoints) || 0,
          teleopPoints: Number(form.teleopPoints) || 0,
          endgamePoints: Number(form.endgamePoints) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a match result</h2>
      <FormGrid min={140}>
        <FormRow label="Match key">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026miket_qm12" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
        <FormRow label="Auto points">
          <input type="number" min={0} value={form.autoPoints} onChange={set("autoPoints")} />
        </FormRow>
        <FormRow label="Teleop points">
          <input type="number" min={0} value={form.teleopPoints} onChange={set("teleopPoints")} />
        </FormRow>
        <FormRow label="Endgame points">
          <input type="number" min={0} value={form.endgamePoints} onChange={set("endgamePoints")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.matchKey.trim() || !form.occurredOn}>
          Log match result
        </button>
      </div>
    </Panel>
  );
}
