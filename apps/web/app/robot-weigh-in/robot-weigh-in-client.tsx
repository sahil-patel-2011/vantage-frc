"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { robotWeighInStationLabel, suggestedWeightLimitLbs, weighIn2026LimitCue } from "../../lib/robot-weigh-in";
import {
  ROBOT_WEIGH_IN_STATIONS,
  type RobotWeighInView,
} from "../../lib/robot-weigh-in/compute-robot-weigh-in";
import type { RobotWeighInStation } from "../../lib/robot-weigh-in/types";
import {
  ROBOT_WEIGH_IN_RELATED_INCLUDE,
  classifyRobotWeighInShell,
  formatRobotWeighInMetric,
  robotWeighInNextActions,
  robotWeighInRelatedLinks,
  robotWeighInSetupSteps,
  robotWeighInShellCopy,
  shouldShowRobotWeighInSummaryTiles,
  type RobotWeighInNextAction,
  type RobotWeighInShellKind,
} from "../../lib/robot-weigh-in/robot-weigh-in-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./robot-weigh-in.css";

type LiveView = Extract<RobotWeighInView, { status: "live" }>;

function fmtLbs(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} lbs`;
}

type MarginTone = "good" | "setup" | "danger" | undefined;

function marginTone(margin: number | null): MarginTone {
  if (margin == null) return undefined;
  if (margin < 0) return "danger";
  if (margin < 3) return "setup";
  return "good";
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = robotWeighInRelatedLinks(orgId, {
    include: [...ROBOT_WEIGH_IN_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related rwi-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: RobotWeighInNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions rwi-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Readiness, Inspection, and Spare Kit — never DEMO scale readings.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WeighShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  shell: RobotWeighInShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = robotWeighInNextActions({ orgId, shell });
  const copy = robotWeighInShellCopy(shell);
  const buildHref = hubHref("/build", "robot-weigh-in", orgId);
  const steps = shell === "setup" ? robotWeighInSetupSteps(orgId) : [];

  return (
    <main className="module-page rwi-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Robot Weigh-In"}
          </>
        }
        title="Robot Weigh-In Log"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Robot Weigh-In">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/build", "readiness-score", orgId)}>
                Open Readiness
              </a>
              <a className="app-button secondary" href={hubHref("/build", "inspection-copilot", orgId)}>
                Open Inspection Copilot
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="rwi-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Readiness and Inspection — never DEMO scale readings.</p>
          </header>
          <ul className="rwi-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted rwi-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function RobotWeighInClient() {
  const [view, setView] = useState<RobotWeighInView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/robot-weigh-in${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RobotWeighInView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const overLimitCount = view?.status === "live" ? view.summary.overLimitCount : 0;

  const shell = classifyRobotWeighInShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    entryCount,
  });
  const shellCopy = robotWeighInShellCopy(shell);
  const nextActions = robotWeighInNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    entryCount,
    overLimitCount,
    playoffReweighCue: view?.status === "live" ? view.playoffReweighCue : null,
  });
  const buildHref = hubHref("/build", "robot-weigh-in", orgId);
  const showTiles = shouldShowRobotWeighInSummaryTiles(entryCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/robot-weigh-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as RobotWeighInView | { error?: string };
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

  if (shell === "loading") {
    return <WeighShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <WeighShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <WeighShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page rwi-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Robot Weigh-In"}
          </>
        }
        title="Robot Weigh-In Log"
        description="Log robot weigh-ins and track the trend against the competition weight limit — never DEMO scale readings."
      >
        <div className="rwi-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted rwi-filter">
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {view.playoffReweighCue ? (
        <p className="rwi-playoff-cue" role="status">
          {view.playoffReweighCue}
        </p>
      ) : null}

      {showTiles ? <SummaryTiles view={view} loaded={loaded} /> : null}
      <LogWeighInForm busy={busy} mutate={mutate} />
      {view.summary.totalEntries > 0 ? <TrendPanel view={view} /> : null}
      <RecentEntries view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  const marginValue = summary.latestMarginLbs == null ? "—" : `${summary.latestMarginLbs.toFixed(1)} lbs`;
  const tone = marginTone(summary.latestMarginLbs);
  const hasGrounding = view.configuredLimitLbs != null || view.bomEstimatedLbs != null;
  return (
    <Panel className="rwi-panel">
      <div className="rwi-stats">
        <StatTile label="Weigh-ins" value={formatRobotWeighInMetric(summary.totalEntries, loaded)} />
        <StatTile label="Latest weight" value={fmtLbs(summary.latestWeightLbs)} />
        <StatTile label="Weight limit" value={fmtLbs(summary.latestWeightLimitLbs)} />
        <StatTile
          label="Margin"
          value={<span className={tone ? `app-badge-text ${tone}` : undefined}>{marginValue}</span>}
        />
        <StatTile label="Over limit" value={formatRobotWeighInMetric(summary.overLimitCount, loaded)} />
      </div>
      {hasGrounding ? (
        <small className="app-muted rwi-block">
          From weight budget:
          {view.configuredLimitLbs != null ? ` configured limit ${view.configuredLimitLbs.toFixed(1)} lbs` : ""}
          {view.configuredLimitLbs != null && view.bomEstimatedLbs != null ? " ·" : ""}
          {view.bomEstimatedLbs != null ? ` BOM estimate ${view.bomEstimatedLbs.toFixed(1)} lbs` : ""}
          {view.bomEstimatedLbs != null && summary.latestWeightLbs != null
            ? ` (actual ${(summary.latestWeightLbs - view.bomEstimatedLbs >= 0 ? "+" : "")}${(summary.latestWeightLbs - view.bomEstimatedLbs).toFixed(1)} lbs vs BOM)`
            : ""}
        </small>
      ) : null}
    </Panel>
  );
}

function TrendPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const max = Math.max(summary.maxWeightLbs ?? 0, summary.latestWeightLimitLbs ?? 0, 1);
  return (
    <Panel className="rwi-panel">
      <h2>Weight trend vs. limit</h2>
      <ul className="rwi-trend">
        {summary.trend.map((point) => (
          <li key={point.weighedOn}>
            <small className="app-muted">{point.weighedOn}</small>
            <span className="mini-probability" aria-hidden="true">
              <i
                style={{
                  width: `${Math.max(2, Math.min(100, (point.weightLbs / max) * 100))}%`,
                  background: point.marginLbs < 0 ? "var(--danger, #d64545)" : undefined,
                }}
              />
            </span>
            <small className="app-muted rwi-trend-val">{point.weightLbs.toFixed(1)} lbs</small>
          </li>
        ))}
      </ul>
      <small className="app-muted">
        Min {fmtLbs(summary.minWeightLbs)} · Max {fmtLbs(summary.maxWeightLbs)}
      </small>
    </Panel>
  );
}

function RecentEntries({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        soft
        badge="No weigh-ins yet"
        badgeTone="setup"
        title="Log your first robot weigh-in"
        description="Track weight readings from the shop scale and event inspections — never DEMO scale packs."
      />
    );
  }
  return (
    <Panel id="robot-weigh-in-entries" className="rwi-panel">
      <h2>Recent weigh-ins</h2>
      <ul className="rwi-list">
        {view.entries.slice(0, 20).map((item) => {
          const limitCue = weighIn2026LimitCue(item);
          return (
          <li key={item.id} className="rwi-row">
            <div>
              <strong>{item.weightLbs.toFixed(1)} lbs</strong>
              <small className="app-muted rwi-block">
                {item.weighedOn} · {robotWeighInStationLabel(item.station)} · limit {item.weightLimitLbs.toFixed(1)}{" "}
                lbs
              </small>
              <small className="app-muted">
                {item.bumpersOn ? "Bumpers on" : "No bumpers"} · {item.batteryOn ? "Battery on" : "No battery"}
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
              {limitCue ? (
                <small className="app-muted" role="status">
                  {limitCue}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete the ${item.weighedOn} weigh-in?`)) {
                  mutate({ action: "delete-weigh-in", entryId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function LogWeighInForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      weighedOn: "",
      weightLbs: "",
      weightLimitLbs: String(suggestedWeightLimitLbs({ bumpersOn: false, batteryOn: false })),
      station: "shop" as RobotWeighInStation,
      bumpersOn: false,
      batteryOn: false,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="robot-weigh-in-form"
      className="rwi-panel"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.weighedOn || !form.weightLbs) return;
        mutate({
          action: "log-weigh-in",
          weighedOn: form.weighedOn,
          weightLbs: Number(form.weightLbs) || 0,
          weightLimitLbs: Number(form.weightLimitLbs) || suggestedWeightLimitLbs(form),
          station: form.station,
          bumpersOn: form.bumpersOn,
          batteryOn: form.batteryOn,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Log weigh-in</h2>
      <p className="app-muted rwi-tip">Real scale readings only — never DEMO weights.</p>
      <FormGrid min={160}>
        <FormRow label="Date">
          <input type="date" value={form.weighedOn} onChange={set("weighedOn")} required />
        </FormRow>
        <FormRow label="Weight (lbs)">
          <input type="number" min={0} step="0.1" value={form.weightLbs} onChange={set("weightLbs")} required />
        </FormRow>
        <FormRow label="Weight limit (lbs)">
          <input type="number" min={1} step="0.1" value={form.weightLimitLbs} onChange={set("weightLimitLbs")} />
        </FormRow>
        <FormRow label="Station">
          <select value={form.station} onChange={set("station")}>
            {ROBOT_WEIGH_IN_STATIONS.map((station) => (
              <option key={station} value={station}>
                {robotWeighInStationLabel(station)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <fieldset className="rwi-checks">
        <label>
          <input
            type="checkbox"
            checked={form.bumpersOn}
            onChange={(event) =>
              setForm((prev) => {
                const bumpersOn = event.target.checked;
                return { ...prev, bumpersOn, weightLimitLbs: String(suggestedWeightLimitLbs({ bumpersOn, batteryOn: prev.batteryOn })) };
              })
            }
          />
          Bumpers on
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.batteryOn}
            onChange={(event) =>
              setForm((prev) => {
                const batteryOn = event.target.checked;
                return { ...prev, batteryOn, weightLimitLbs: String(suggestedWeightLimitLbs({ bumpersOn: prev.bumpersOn, batteryOn })) };
              })
            }
          />
          Battery on
        </label>
      </fieldset>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.weighedOn || !form.weightLbs}>
          Log weigh-in
        </button>
      </div>
    </Panel>
  );
}
