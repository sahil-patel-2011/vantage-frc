"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { robotWeighInStationLabel } from "../../lib/robot-weigh-in";
import {
  ROBOT_WEIGH_IN_STATIONS,
  type RobotWeighInView,
} from "../../lib/robot-weigh-in/compute-robot-weigh-in";
import type { RobotWeighInStation } from "../../lib/robot-weigh-in/types";

type LiveView = Extract<RobotWeighInView, { status: "live" }>;

function fmtLbs(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} lbs`;
}

function marginTone(margin: number | null): string {
  if (margin == null) return "";
  if (margin < 0) return "demo";
  if (margin < 3) return "setup";
  return "good";
}

export default function RobotWeighInClient() {
  const [view, setView] = useState<RobotWeighInView | null>(null);
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Robot Weigh-In"}
          </>
        }
        title="Robot Weigh-In Log"
        description="Log robot weigh-ins and track the trend against the competition weight limit through the build season."
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
          title="Could not load Robot Weigh-In"
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
          <LogWeighInForm busy={busy} mutate={mutate} />
          {view.summary.totalEntries > 0 ? <TrendPanel view={view} /> : null}
          <RecentEntries view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Weigh-ins", value: String(summary.totalEntries) },
    { label: "Latest weight", value: fmtLbs(summary.latestWeightLbs) },
    { label: "Weight limit", value: fmtLbs(summary.latestWeightLimitLbs) },
    { label: "Margin", value: summary.latestMarginLbs == null ? "—" : `${summary.latestMarginLbs.toFixed(1)} lbs` },
    { label: "Over limit", value: String(summary.overLimitCount) },
  ];
  const hasGrounding = view.configuredLimitLbs != null || view.bomEstimatedLbs != null;
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong
              style={{ fontSize: "1.6rem", display: "block" }}
              className={tile.label === "Margin" ? `app-badge-text ${marginTone(summary.latestMarginLbs)}` : undefined}
            >
              {tile.value}
            </strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {hasGrounding ? (
        <small className="app-muted" style={{ display: "block", marginTop: 10 }}>
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
  const max = Math.max(
    summary.maxWeightLbs ?? 0,
    summary.latestWeightLimitLbs ?? 0,
    1,
  );
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Weight trend vs. limit</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {summary.trend.map((point) => (
          <li key={point.weighedOn} style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px", gap: 8, alignItems: "center" }}>
            <small className="app-muted">{point.weighedOn}</small>
            <span className="mini-probability" aria-hidden="true">
              <i
                style={{
                  width: `${Math.max(2, Math.min(100, (point.weightLbs / max) * 100))}%`,
                  background: point.marginLbs < 0 ? "var(--danger, #d64545)" : undefined,
                }}
              />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>
              {point.weightLbs.toFixed(1)} lbs
            </small>
          </li>
        ))}
      </ul>
      <small className="app-muted">Min {fmtLbs(summary.minWeightLbs)} · Max {fmtLbs(summary.maxWeightLbs)}</small>
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
        badge="No weigh-ins yet"
        badgeTone="setup"
        title="Log your first robot weigh-in"
        description="Track weight readings from the shop scale and event inspections to spot the trend before competition."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent weigh-ins</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.weightLbs.toFixed(1)} lbs</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.weighedOn} · {robotWeighInStationLabel(item.station)} · limit {item.weightLimitLbs.toFixed(1)} lbs
              </small>
              <small className="app-muted">
                {item.bumpersOn ? "Bumpers on" : "No bumpers"} · {item.batteryOn ? "Battery on" : "No battery"}
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
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
        ))}
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
      weightLimitLbs: "125",
      station: "shop" as RobotWeighInStation,
      bumpersOn: true,
      batteryOn: true,
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
        if (!form.weighedOn || !form.weightLbs) return;
        mutate({
          action: "log-weigh-in",
          weighedOn: form.weighedOn,
          weightLbs: Number(form.weightLbs) || 0,
          weightLimitLbs: Number(form.weightLimitLbs) || 125,
          station: form.station,
          bumpersOn: form.bumpersOn,
          batteryOn: form.batteryOn,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log weigh-in</h2>
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
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.bumpersOn}
            onChange={(event) => setForm((prev) => ({ ...prev, bumpersOn: event.target.checked }))}
          />
          Bumpers on
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.batteryOn}
            onChange={(event) => setForm((prev) => ({ ...prev, batteryOn: event.target.checked }))}
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
