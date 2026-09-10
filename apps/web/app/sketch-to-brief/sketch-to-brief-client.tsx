"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { mechanismCategoryLabel } from "../../lib/sketch-to-brief";
import type { SketchToBriefView } from "../../lib/sketch-to-brief/compute-sketch-to-brief";
import {
  SKETCH_TO_BRIEF_RELATED_INCLUDE,
  classifySketchToBriefShell,
  formatSketchToBriefMetric,
  sketchToBriefNextActions,
  sketchToBriefRelatedLinks,
  sketchToBriefShellCopy,
  type SketchToBriefNextAction,
  type SketchToBriefShellKind,
} from "../../lib/sketch-to-brief/sketch-to-brief-related";
import type { BriefRecord, MechanismCategory, RuleFlagSeverity, SketchRecord } from "../../lib/sketch-to-brief/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./sketch-to-brief.css";

const SEVERITY_TONE: Record<RuleFlagSeverity, string> = {
  info: "setup",
  caution: "demo",
  blocker: "demo",
};

type LiveView = Extract<SketchToBriefView, { status: "live" }>;

function isSketchToBriefView(value: unknown): value is SketchToBriefView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function sketchToBriefCacheOrg(data: SketchToBriefView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistSketchToBriefSnapshot(
  orgHint: string,
  seasonHint: string,
  data: SketchToBriefView,
): Promise<void> {
  const cacheOrg = sketchToBriefCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("sketch-to-brief", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("sketch-to-brief", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Sketch-to-Brief already painted; IndexedDB is best-effort.
  }
}

function SketchRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = sketchToBriefRelatedLinks(orgId, {
    include: [...SKETCH_TO_BRIEF_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sketch-to-brief-related" aria-label="Related build tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function SketchNextActionsPanel({ actions }: { actions: SketchToBriefNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions sketch-to-brief-next-actions"
      aria-label="Next actions"
    >
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

function SketchShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SketchToBriefShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = sketchToBriefNextActions({ orgId, shell });
  const copy = sketchToBriefShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "sketch-to-brief", orgId);

  return (
    <main className="module-page sketch-to-brief-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Sketch-to-Brief"}
          </>
        }
        title="Sketch-to-Brief"
        description={description}
      >
        <SketchRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No sketches yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#sketch-to-brief-log-sketch">Log a sketch</Button>
        ) : null}
      </EmptyState>
      <SketchNextActionsPanel actions={actions} />
    </main>
  );
}

export default function SketchToBriefClient() {
  const [view, setView] = useState<SketchToBriefView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SketchToBriefView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<SketchToBriefView>(
          "sketch-to-brief",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isSketchToBriefView(cached.data)) {
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
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/sketch-to-brief${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as SketchToBriefView | { error?: string };
        if (!response.ok || !isSketchToBriefView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Sketch-to-Brief. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistSketchToBriefSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Sketch-to-Brief. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sketchCount = view?.status === "live" ? view.sketches.length : 0;
  const briefCount = view?.status === "live" ? view.briefs.length : 0;
  const draftCount =
    view?.status === "live" ? view.sketches.filter((row) => row.status === "draft").length : 0;
  const ruleFlagCount =
    view?.status === "live"
      ? view.briefs.reduce((sum, brief) => sum + brief.brief.ruleFlags.length, 0)
      : 0;

  const shell = classifySketchToBriefShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    sketchCount,
  });
  const shellCopy = sketchToBriefShellCopy(shell);
  const nextActions = sketchToBriefNextActions({
    orgId,
    shell,
    sketchCount,
    briefCount,
    draftCount,
    ruleFlagCount,
  });
  const relatedLinks = sketchToBriefRelatedLinks(orgId, {
    include: [...SKETCH_TO_BRIEF_RELATED_INCLUDE],
  });
  const buildHref = hubWorkbenchHref("build", "sketch-to-brief", orgId);
  const kickoffHref = hubHref("/build", "kickoff", orgId);
  const cadHref = hubHref("/build", "cad", orgId);

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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as SketchToBriefView | { error?: string };
        if (!response.ok || !isSketchToBriefView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistSketchToBriefSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return (
      <SketchShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Sketch-to-Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </SketchShell>
    );
  }

  if (shell === "error") {
    return (
      <SketchShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Sketch-to-Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </SketchShell>
    );
  }

  if (shell === "setup") {
    return (
      <SketchShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Sketch-to-Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </SketchShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <SketchShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Sketch-to-Brief" fromCache={fromCache} cachedAt={cachedAt} />
      </SketchShell>
    );
  }

  return (
    <main className="module-page sketch-to-brief-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Sketch-to-Brief"}
          </>
        }
        title="Sketch-to-Brief"
        description="Transcribe a kickoff whiteboard sketch and get a grounded first-pass CAD brief plus a rule-compliance check — from your team's Kickoff notes and design priorities only. Cross-check Kickoff and CAD."
      >
        <div className="sketch-to-brief-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted sketch-to-brief-season">
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
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Sketch-to-Brief" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <SketchNextActionsPanel actions={nextActions} />

      <SummaryTiles
        sketchCount={sketchCount}
        briefCount={briefCount}
        draftCount={draftCount}
        ruleFlagCount={ruleFlagCount}
        loaded
      />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sketches yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#sketch-to-brief-log-sketch">
            Log a sketch
          </Button>
        </EmptyState>
      ) : null}

      <div className="sketch-to-brief-layout">
        <LogSketchForm busy={busy} mutate={mutate} />
        <SketchList view={view} busy={busy} mutate={mutate} />
        <BriefList view={view} kickoffHref={kickoffHref} cadHref={cadHref} />
        <Panel className="sketch-to-brief-tip" aria-label="Sketch-to-Brief tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep{" "}
            <a href={kickoffHref}>Kickoff</a> rule notes and design priorities aligned with brief
            grounding, then model the mechanism in <a href={cadHref}>CAD</a>.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({
  sketchCount,
  briefCount,
  draftCount,
  ruleFlagCount,
  loaded,
}: {
  sketchCount: number;
  briefCount: number;
  draftCount: number;
  ruleFlagCount: number;
  loaded: boolean;
}) {
  const tiles = [
    { label: "Sketches", value: formatSketchToBriefMetric(sketchCount, loaded) },
    { label: "Drafts", value: formatSketchToBriefMetric(draftCount, loaded) },
    { label: "CAD briefs", value: formatSketchToBriefMetric(briefCount, loaded) },
    { label: "Rule flags", value: formatSketchToBriefMetric(ruleFlagCount, loaded) },
  ];
  return (
    <section className="sketch-to-brief-stats" aria-label="Sketch-to-Brief counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
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
      id="sketch-to-brief-log-sketch"
      as="form"
      className="sketch-to-brief-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.notes.trim()) return;
        mutate({ action: "log-sketch", title: form.title, notes: form.notes });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Log a kickoff sketch</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Transcribe the whiteboard: mechanism labels, function, and any dimensions or rule callouts written
        on it. The brief is built from what you write here and what your team logged in Kickoff &amp; Game
        Analysis, so include any dimensions or rule callouts you want it to use.
      </p>
      <FormRow label="Title">
        <input value={form.title} onChange={set("title")} placeholder="Coral intake concept" required />
      </FormRow>
      <FormRow label="Transcribed sketch notes">
        <textarea
          value={form.notes}
          onChange={set("notes")}
          rows={6}
          placeholder={
            "Roller intake on 2 in hex, extends 12 in past frame perimeter\nUnder-bumper feed to a 6 in indexer"
          }
          required
        />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim() || !form.notes.trim()}>
          Log sketch
        </Button>
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
      <div id="sketch-to-brief-sketches">
        <EmptyState
          soft
          badge="No sketches yet"
          badgeTone="setup"
          title="Log your first kickoff sketch"
          description="Once logged, generate a grounded first-pass CAD brief from it."
        >
          <Button as="a" variant="primary" href="#sketch-to-brief-log-sketch">
            Log a sketch
          </Button>
        </EmptyState>
      </div>
    );
  }
  return (
    <Panel id="sketch-to-brief-sketches" className="sketch-to-brief-panel">
      <h2 style={{ marginTop: 0 }}>Sketches</h2>
      <ul className="sketch-to-brief-list">
        {view.sketches.map((sketch: SketchRecord) => (
          <li key={sketch.id} className="sketch-to-brief-card">
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
            <div className="sketch-to-brief-card-actions">
              <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "generate-brief", sketchId: sketch.id })}>
                Generate brief
              </Button>
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

function BriefList({
  view,
  kickoffHref,
  cadHref,
}: {
  view: LiveView;
  kickoffHref: string;
  cadHref: string;
}) {
  if (view.briefs.length === 0) {
    if (view.sketches.length === 0) return null;
    return (
      <div id="sketch-to-brief-briefs">
        <EmptyState
          soft
          badge="No briefs yet"
          badgeTone="setup"
          title="Generate a CAD brief from a logged sketch"
          description="Briefs stay blank until you generate one from a real sketch."
        >
          <Button as="a" variant="primary" href="#sketch-to-brief-sketches">
            View sketches
          </Button>
        </EmptyState>
      </div>
    );
  }
  return (
    <Panel id="sketch-to-brief-briefs" className="sketch-to-brief-panel">
      <h2 style={{ marginTop: 0 }}>Drafted CAD briefs</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {view.briefs.map((brief: BriefRecord) => (
          <article key={brief.id} className="soft-panel sketch-to-brief-brief">
            <header className="sketch-to-brief-brief-header">
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
                      <span className={`app-badge ${SEVERITY_TONE[flag.severity]}`}>
                        {flag.severity.toUpperCase()}
                      </span>{" "}
                      {flag.summary}
                      {flag.ruleRef ? ` (${flag.ruleRef})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <small className="app-muted">No rule flags raised from your team's logged rule notes.</small>
            )}
            <p className="app-muted" style={{ margin: "8px 0 0" }}>
              Continue in <a href={cadHref}>CAD</a> · ground rules in <a href={kickoffHref}>Kickoff</a>
            </p>
          </article>
        ))}
      </div>
    </Panel>
  );
}
