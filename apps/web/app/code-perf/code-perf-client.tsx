"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { CHANGE_TYPES, SUBSYSTEMS, changeTypeLabel, subsystemLabel, verdictLabel } from "../../lib/code-perf";
import type { CodePerfView } from "../../lib/code-perf/compute-code-perf";
import type { ChangeType, CorrelationVerdict, Subsystem } from "../../lib/code-perf/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function verdictTone(verdict: CorrelationVerdict): string {
  if (verdict === "improved") return "good";
  if (verdict === "regressed") return "demo";
  if (verdict === "neutral") return "setup";
  return "setup";
}

type LiveView = Extract<CodePerfView, { status: "live" }>;

function isCodePerfView(value: unknown): value is CodePerfView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function codePerfCacheOrg(data: CodePerfView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistCodePerfSnapshot(orgHint: string, seasonHint: string, data: CodePerfView): Promise<void> {
  const cacheOrg = codePerfCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("code-perf", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("code-perf", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Code vs match already painted; IndexedDB is best-effort.
  }
}

function CodePerfRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "code", orgId)}>
        Code
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "code-deploy-log", orgId)}>
        Deploy log
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "cad", orgId)}>
        CAD
      </Button>
    </nav>
  );
}

function CodePerfNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log a change",
      detail: "Record a commit, version bump, or tuning change beside match scores.",
      href: "#code-perf-log",
      primary: true,
    },
    {
      id: "code",
      label: "Open Code",
      detail: "Review robot code before you log a change here.",
      href: hubHref("/build", "code", orgId),
      primary: false,
    },
    {
      id: "deploy",
      label: "Open Deploy log",
      detail: "Firmware deploys sit next to this match-linked board.",
      href: hubHref("/build", "code-deploy-log", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function CodePerfClient() {
  const [view, setView] = useState<CodePerfView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CodePerfView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CodePerfView>("code-perf", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isCodePerfView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setLoadStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/code-perf${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setLoadStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isCodePerfView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Code vs match. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setLoadStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistCodePerfSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Code vs match. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isCodePerfView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistCodePerfSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Code vs match"}
        </>
      }
      title="Code vs match"
      description="Log commits, software-version bumps, and tuning changes alongside match auto/teleop points — see whether a change actually moved on-field performance."
    >
      <CodePerfRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Code vs match" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Code vs match" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Code vs match" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <CodePerfNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <LogChangeForm busy={busy} mutate={mutate} />
        <LogMatchResultForm busy={busy} mutate={mutate} />
        <ChangesList view={view} busy={busy} mutate={mutate} />
        <MatchResultsList view={view} busy={busy} mutate={mutate} />
      </div>
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
              <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "analyze-change", changeId: item.id })}>
                Analyze
              </Button>
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
        description="Match results are the ground truth this board correlates changes against."
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
      id="code-perf-log"
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
          <input value={form.title} onChange={set("title")} placeholder="Retune shooter gains" required />
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
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim() || !form.occurredOn}>
          Log change
        </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.matchKey.trim() || !form.occurredOn}>
          Log match result
        </Button>
      </div>
    </Panel>
  );
}
