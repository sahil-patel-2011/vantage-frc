"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { knowledgeGapSubjectLabel } from "../../lib/knowledge-gap";
import type { KnowledgeGapView } from "../../lib/knowledge-gap/compute-knowledge-gap";
import type { KnowledgeGapItem, KnowledgeGapStatus, KnowledgeGapSubjectKind } from "../../lib/knowledge-gap/types";

const STATUS_TONE: Record<KnowledgeGapStatus, string> = {
  open: "setup",
  drafted: "good",
  dismissed: "demo",
};

const STATUS_LABEL: Record<KnowledgeGapStatus, string> = {
  open: "Undocumented",
  drafted: "Stub drafted",
  dismissed: "Dismissed",
};

const SUBJECT_TONE: Record<KnowledgeGapSubjectKind, string> = {
  subsystem: "demo",
  decision: "setup",
  event: "good",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<KnowledgeGapView, { status: "live" }>;

export default function KnowledgeGapClient() {
  const [view, setView] = useState<KnowledgeGapView | null>(null);
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
    void fetch(`/api/knowledge-gap${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
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
        const response = await fetch("/api/knowledge-gap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
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
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Knowledge-gap detective"}
          </>
        }
        title="Knowledge-gap detective"
        description="Scans your wiki and decision log against real subsystems and scouted events, and flags what has no documentation — then drafts a stub page for it."
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
            <a className="app-button secondary" href={`/knowledge?orgId=${encodeURIComponent(orgId)}`}>
              Open wiki
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
          title="Could not load the Knowledge-gap detective"
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
          <ScanPanel view={view} busy={busy} mutate={mutate} season={season ?? view.seasonYear} />
          {view.scan == null ? (
            <EmptyState
              badge="No scan yet"
              badgeTone="setup"
              title="Run your first scan"
              description="Diffs robot_subsystems, decision_records, and scouted events against your knowledge_pages wiki for this season — nothing is invented."
            />
          ) : view.items.length === 0 ? (
            <EmptyState
              badge="Fully documented"
              badgeTone="good"
              title="No gaps found for this season"
              description="Every tracked subsystem, decision, and scouted event has wiki coverage."
            />
          ) : (
            <GapList items={view.items} busy={busy} mutate={mutate} />
          )}
        </div>
      )}
    </main>
  );
}

function ScanPanel({
  view,
  busy,
  mutate,
  season,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  season: number;
}) {
  const scan = view.scan;
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Coverage — {season}</h2>
          {scan ? (
            <small className="app-muted">
              {scan.subsystemCount} subsystem(s) · {scan.decisionCount} decision(s) · {scan.eventCount} scouted
              event(s) · {scan.pageCount} wiki page(s) · scanned {new Date(scan.createdAt).toLocaleString()}
            </small>
          ) : (
            <small className="app-muted">No scan has been run for {season} yet.</small>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {scan ? <strong style={{ fontSize: "1.8rem" }}>{pct(scan.coverageScore)}</strong> : null}
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => mutate({ action: "run-scan" })}
          >
            {scan ? "Re-scan" : "Run scan"}
          </button>
        </div>
      </header>
      {scan ? <p className="app-muted" style={{ marginBottom: 0 }}>{scan.summary}</p> : null}
    </Panel>
  );
}

function GapList({
  items,
  busy,
  mutate,
}: {
  items: KnowledgeGapItem[];
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Undocumented subjects</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {items.map((item) => (
          <li key={item.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${SUBJECT_TONE[item.subjectKind]}`}>
                  {knowledgeGapSubjectLabel(item.subjectKind)}
                </span>{" "}
                <span className={`app-badge ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.subjectRef}</strong>
                <small className="app-muted">Season {item.seasonYear}</small>
              </div>
              {item.status === "open" ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "draft-stub-page", itemId: item.id })}
                  >
                    Draft stub page
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "dismiss-item", itemId: item.id })}
                  >
                    Dismiss
                  </button>
                </div>
              ) : item.status === "drafted" && item.draftPageId ? (
                <a className="app-button secondary" href={`/knowledge?pageId=${encodeURIComponent(item.draftPageId)}`}>
                  Open stub
                </a>
              ) : null}
            </header>
            <p className="app-muted" style={{ margin: 0 }}>
              {item.reason}
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
