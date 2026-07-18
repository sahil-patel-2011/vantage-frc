"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { mechanismCategoryLabel } from "../../lib/sketch-to-brief";
import type { SketchToBriefView } from "../../lib/sketch-to-brief/compute-sketch-to-brief";
import type { BriefRecord, MechanismCategory, RuleFlagSeverity, SketchRecord } from "../../lib/sketch-to-brief/types";

const SEVERITY_TONE: Record<RuleFlagSeverity, string> = {
  info: "setup",
  caution: "demo",
  blocker: "demo",
};

type LiveView = Extract<SketchToBriefView, { status: "live" }>;

export default function SketchToBriefClient() {
  const [view, setView] = useState<SketchToBriefView | null>(null);
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
    void fetch(`/api/sketch-to-brief${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SketchToBriefView | { error?: string };
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
        const response = await fetch("/api/sketch-to-brief", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SketchToBriefView | { error?: string };
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
            {" / Sketch-to-Brief"}
          </>
        }
        title="Sketch-to-Brief"
        description="Transcribe a kickoff whiteboard sketch and get a grounded first-pass CAD brief plus a rule-compliance check — cross-referenced against your team's own kickoff rule notes and design priorities."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
          {orgId ? (
            <a className="app-button secondary" href={`/build?orgId=${encodeURIComponent(orgId)}`}>
              Build hub
            </a>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Sketch-to-Brief"
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
          <LogSketchForm busy={busy} mutate={mutate} />
          <SketchList view={view} busy={busy} mutate={mutate} />
          <BriefList view={view} />
        </div>
      )}
    </main>
  );
}

function LogSketchForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ title: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.notes.trim()) return;
        mutate({ action: "log-sketch", title: form.title, notes: form.notes });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a kickoff sketch</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Transcribe the whiteboard: mechanism labels, function, and any dimensions or rule callouts written on it.
        Sketch-to-Brief never invents dimensions or rule text — it only works from what you write here and what
        your team already logged in Kickoff &amp; Game Analysis.
      </p>
      <FormRow label="Title">
        <input value={form.title} onChange={set("title")} placeholder="Coral intake concept" required />
      </FormRow>
      <FormRow label="Transcribed sketch notes">
        <textarea
          value={form.notes}
          onChange={set("notes")}
          rows={6}
          placeholder={"Roller intake on 2 in hex, extends 12 in past frame perimeter\nUnder-bumper feed to a 6 in indexer"}
          required
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.notes.trim()}>
          Log sketch
        </button>
      </div>
    </Panel>
  );
}

function SketchList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sketches.length === 0) {
    return (
      <EmptyState
        badge="No sketches yet"
        badgeTone="setup"
        title="Log your first kickoff sketch"
        description="Once logged, generate a grounded first-pass CAD brief from it."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Sketches</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.sketches.map((sketch: SketchRecord) => (
          <li key={sketch.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{sketch.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {mechanismCategoryLabel(sketch.category)} ·{" "}
                <span className={`app-badge ${sketch.status === "brief_ready" ? "good" : "setup"}`}>
                  {sketch.status === "brief_ready" ? "Brief ready" : "Draft"}
                </span>
              </small>
              <small className="app-muted" style={{ display: "block", maxWidth: 560, whiteSpace: "pre-wrap" }}>
                {sketch.notes.slice(0, 220)}
                {sketch.notes.length > 220 ? "…" : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => mutate({ action: "generate-brief", sketchId: sketch.id })}
              >
                Generate brief
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${sketch.title}"?`)) {
                    mutate({ action: "delete-sketch", sketchId: sketch.id });
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

function BriefList({ view }: { view: LiveView }) {
  if (view.briefs.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Drafted CAD briefs</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {view.briefs.map((brief: BriefRecord) => (
          <article key={brief.id} className="soft-panel" style={{ padding: 12, borderRadius: 8 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <strong>{brief.title}</strong>
              <small className="app-muted">{new Date(brief.createdAt).toLocaleString()}</small>
            </header>
            <p className="app-muted" style={{ margin: "4px 0 8px" }}>
              {mechanismCategoryLabel(brief.brief.category as MechanismCategory)} — {brief.brief.mechanismIntent}
            </p>
            {brief.brief.sections.map((section) => (
              <div key={section.heading} style={{ marginBottom: 8 }}>
                <strong className="app-muted">{section.heading}</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {section.bullets.map((bullet, index) => (
                    <li key={index}>{bullet}</li>
                  ))}
                </ul>
              </div>
            ))}
            {brief.brief.ruleFlags.length > 0 ? (
              <div>
                <strong className="app-muted">Rule-compliance flags</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {brief.brief.ruleFlags.map((flag, index) => (
                    <li key={index}>
                      <span className={`app-badge ${SEVERITY_TONE[flag.severity]}`}>{flag.severity.toUpperCase()}</span>{" "}
                      {flag.summary}
                      {flag.ruleRef ? ` (${flag.ruleRef})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <small className="app-muted">No rule flags raised from your team's logged rule notes.</small>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}
