"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { CadReviewQueueView } from "../../lib/cad-review-queue/compute-cad-review-queue";
import {
  CAD_REVIEW_CHECKPOINTS,
  CAD_REVIEW_PRIORITIES,
  cadReviewCheckpointLabel,
  cadReviewPriorityLabel,
  cadReviewStatusLabel,
  signoffProgress,
} from "../../lib/cad-review-queue";
import type { CadReviewItem } from "../../lib/cad-review-queue/types";

type LiveView = Extract<CadReviewQueueView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function CadReviewQueueClient() {
  const [view, setView] = useState<CadReviewQueueView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seasonYear, setSeasonYear] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("seasonYear") ? Number(params.get("seasonYear")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("seasonYear", String(seasonQuery));
    void fetch(`/api/cad-review-queue${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CadReviewQueueView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
        if ("seasonYear" in data) setSeasonYear(data.seasonYear);
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
        const response = await fetch("/api/cad-review-queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: seasonYear ?? undefined, ...payload }),
        });
        const data = (await response.json()) as CadReviewQueueView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        if ("seasonYear" in data) setSeasonYear(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, seasonYear, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / CAD Review Queue"}
          </>
        }
        title="CAD Review Queue"
        description="Route CAD parts and assemblies through design checkpoints and reviewer sign-offs before releasing them to manufacture."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={seasonYear ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeasonYear(next);
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
          {view.orgId ? <SubmitItemForm busy={busy} mutate={mutate} /> : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <SubmitItemForm busy={busy} mutate={mutate} />
          <ItemsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const tiles = [
    { label: "Items in queue", value: String(view.summary.totalItems) },
    { label: "Pending review", value: String(view.summary.pendingCount) },
    { label: "Changes requested", value: String(view.summary.changesRequestedCount) },
    { label: "Ready for manufacture", value: String(view.summary.readyForManufactureCount) },
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
    </Panel>
  );
}

function ItemsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.items.length === 0) {
    return (
      <EmptyState
        badge="No items yet"
        badgeTone="setup"
        title="Submit your first CAD part for review"
        description="Once parts are queued, they will move through design checkpoints and collect reviewer sign-offs here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Review queue</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.items.map((item) => (
          <ItemCard key={item.id} item={item} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function ItemCard({
  item,
  busy,
  mutate,
}: {
  item: CadReviewItem;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const approvals = item.signoffs.filter((s) => s.decision === "approved").length;
  return (
    <li className="app-card soft-panel" style={{ padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <strong>{item.partName}</strong>
          <small className="app-muted" style={{ display: "block" }}>
            {cadReviewCheckpointLabel(item.checkpoint)} · {cadReviewPriorityLabel(item.priority)} priority ·{" "}
            {cadReviewStatusLabel(item.status)}
          </small>
          {item.description ? (
            <small className="app-muted" style={{ display: "block" }}>
              {item.description}
            </small>
          ) : null}
          {item.cadLink ? (
            <a href={item.cadLink} target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem" }}>
              Open CAD
            </a>
          ) : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <small className="app-muted" style={{ display: "block" }}>
            {approvals}/{item.requiredSignoffs} sign-offs · {pct(signoffProgress(item))}
          </small>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove "${item.partName}" from the queue?`)) {
                mutate({ action: "delete-item", itemId: item.id });
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {item.signoffs.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 8, display: "grid", gap: 4 }}>
          {item.signoffs.map((s) => (
            <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{s.decision === "approved" ? "Approved" : "Changes requested"}</span>
              <small className="app-muted">{s.comment ?? ""}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted" style={{ marginTop: 8 }}>
          No sign-offs yet.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={() => mutate({ action: "add-signoff", itemId: item.id, decision: "approved" })}
        >
          Approve
        </button>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => mutate({ action: "add-signoff", itemId: item.id, decision: "changes_requested" })}
        >
          Request changes
        </button>
        {item.status === "approved" ? (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() => mutate({ action: "update-status", itemId: item.id, status: "released" })}
          >
            Release to manufacture
          </button>
        ) : null}
      </div>
    </li>
  );
}

function SubmitItemForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      partName: "",
      description: "",
      checkpoint: "design_review",
      cadLink: "",
      priority: "normal",
      requiredSignoffs: "1",
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
        if (!form.partName.trim()) return;
        mutate({
          action: "submit-item",
          partName: form.partName.trim(),
          description: form.description || undefined,
          checkpoint: form.checkpoint,
          cadLink: form.cadLink || undefined,
          priority: form.priority,
          requiredSignoffs: Number(form.requiredSignoffs) || 1,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Submit part for review</h2>
      <FormGrid min={160}>
        <FormRow label="Part name">
          <input value={form.partName} onChange={set("partName")} placeholder="Intake roller bracket" required />
        </FormRow>
        <FormRow label="Checkpoint">
          <select value={form.checkpoint} onChange={set("checkpoint")}>
            {CAD_REVIEW_CHECKPOINTS.map((checkpoint) => (
              <option key={checkpoint} value={checkpoint}>
                {cadReviewCheckpointLabel(checkpoint)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {CAD_REVIEW_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {cadReviewPriorityLabel(priority)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Required sign-offs">
          <input type="number" min={1} value={form.requiredSignoffs} onChange={set("requiredSignoffs")} />
        </FormRow>
      </FormGrid>
      <FormRow label="CAD link (optional)">
        <input value={form.cadLink} onChange={set("cadLink")} placeholder="https://cad.onshape.com/documents/…" />
      </FormRow>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.partName.trim()}>
          Submit part
        </button>
      </div>
    </Panel>
  );
}
