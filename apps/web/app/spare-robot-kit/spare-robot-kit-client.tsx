"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { priorityLabel } from "../../lib/spare-robot-kit";
import { CHECKLIST_STATUSES, type SpareRobotKitView } from "../../lib/spare-robot-kit/compute-spare-robot-kit";
import type { ChecklistStatus, KitPriority } from "../../lib/spare-robot-kit/types";

const PRIORITY_TONE: Record<KitPriority, string> = {
  critical: "demo",
  recommended: "setup",
  optional: "good",
};

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  draft: "Draft",
  finalized: "Finalized",
};

type LiveView = Extract<SpareRobotKitView, { status: "live" }>;

export default function SpareRobotKitClient() {
  const [view, setView] = useState<SpareRobotKitView | null>(null);
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
    void fetch(`/api/spare-robot-kit${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SpareRobotKitView | { error?: string };
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
        const response = await fetch("/api/spare-robot-kit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SpareRobotKitView | { error?: string };
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
            {" / Spare Robot Kit"}
          </>
        }
        title="Spare Robot Kit Checklist"
        description="Generates a competition spare-parts kit checklist by cross-referencing inventory spare bins against FMEA repeat-failure history — pack what's actually failed, not a guess."
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
          title="Could not load the spare-robot-kit checklist"
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
          <CandidatesPanel view={view} busy={busy} mutate={mutate} />
          {view.checklists.length > 0 ? <ChecklistsList view={view} busy={busy} mutate={mutate} /> : null}
        </div>
      )}
    </main>
  );
}

function CandidatesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");

  if (view.candidateItems.length === 0) {
    return (
      <EmptyState
        badge="No kit candidates yet"
        badgeTone="setup"
        title="No spares are currently matched to FMEA history"
        description="Once spare-category inventory items are tagged with a subsystem that has logged FMEA failures, Vantage will surface what to pack for competition."
      />
    );
  }

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Kit candidates</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`Spare robot kit — ${view.seasonYear}`}
            style={{ minWidth: 220 }}
          />
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => {
              mutate({ action: "generate-checklist", title: title.trim() || undefined });
              setTitle("");
            }}
          >
            Generate checklist
          </button>
        </div>
      </header>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, marginTop: 12 }}>
        {view.candidateItems.map((item) => (
          <li key={item.itemId} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${PRIORITY_TONE[item.priority]}`}>{priorityLabel(item.priority)}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.itemName}</strong>
                <small className="app-muted">
                  {item.subsystem ?? "Unmatched subsystem"} · {item.quantityOnHand} on hand · {item.failureCount} FMEA
                  failure(s) this season
                </small>
              </div>
            </header>
            <small className="app-muted">{item.rationale}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChecklistsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Checklists</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.checklists.map((checklist) => {
          const packedCount = checklist.items.filter((item) => item.packed).length;
          return (
            <li key={checklist.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <strong>{checklist.title}</strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {STATUS_LABEL[checklist.status]} · {packedCount}/{checklist.items.length} packed
                  </small>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${checklist.title}"?`)) {
                      mutate({ action: "delete-checklist", checklistId: checklist.id });
                    }
                  }}
                >
                  Delete
                </button>
              </header>
              <small className="app-muted">{checklist.rationale}</small>
              <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
                {checklist.items.map((item) => (
                  <li key={item.itemId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={item.packed}
                        disabled={busy}
                        onChange={() =>
                          mutate({ action: "toggle-packed", checklistId: checklist.id, itemId: item.itemId })
                        }
                      />
                      {item.itemName} × {item.recommendedQty}
                    </label>
                    <small className="app-muted">{priorityLabel(item.priority)}</small>
                  </li>
                ))}
              </ul>
              {checklist.status !== "finalized" ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {CHECKLIST_STATUSES.filter((status) => status !== checklist.status).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() => mutate({ action: "update-status", checklistId: checklist.id, status })}
                    >
                      Mark {STATUS_LABEL[status].toLowerCase()}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
