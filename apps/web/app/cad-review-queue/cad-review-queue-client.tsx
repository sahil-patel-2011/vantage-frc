"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

type LiveView = Extract<CadReviewQueueView, { status: "live" }>;

function isCadReviewQueueView(value: unknown): value is CadReviewQueueView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function cadReviewCacheOrg(data: CadReviewQueueView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistCadReviewQueueSnapshot(
  orgHint: string,
  seasonHint: string,
  data: CadReviewQueueView,
): Promise<void> {
  const cacheOrg = cadReviewCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("cad-review-queue", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("cad-review-queue", "_", data, seasonHint || seasonKey);
  } catch {
    // Live CAD review queue already painted; IndexedDB is best-effort.
  }
}

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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CadReviewQueueView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("seasonYear") ? Number(params.get("seasonYear")) : null);
    const seasonHint =
      seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CadReviewQueueView>("cad-review-queue", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isCadReviewQueueView(cached.data)) {
        setView(cached.data);
        setSeasonYear(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadStatus(null);
    setLoadError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery != null && Number.isFinite(seasonQuery)) query.set("seasonYear", String(seasonQuery));
      const response = await fetch(`/api/cad-review-queue${query.toString() ? `?${query.toString()}` : ""}`, {
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
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isCadReviewQueueView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh CAD review queue. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setLoadStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeasonYear(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistCadReviewQueueSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh CAD review queue. Showing the last copy on this device.");
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
        const response = await fetch("/api/cad-review-queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: seasonYear ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isCadReviewQueueView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeasonYear(data.seasonYear);
        setFromCache(false);
        void persistCadReviewQueueSnapshot(orgId, String(data.seasonYear), data);
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
            {" / CAD review queue"}
          </>
        }
        title="CAD review queue"
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
      <OfflineBanner feature="CAD review queue" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        fetchFailed ? (
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
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => void load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
          })()
        ) : (
          <EmptyState title="Opening CAD review queue" description="Checking your team." aria-busy />
        )
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
          
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
        <Button variant="primary" type="button" disabled={busy} onClick={() => mutate({ action: "add-signoff", itemId: item.id, decision: "approved" })}>
          Approve
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "add-signoff", itemId: item.id, decision: "changes_requested" })}>
          Request changes
        </Button>
        {item.status === "approved" ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-status", itemId: item.id, status: "released" })}>
            Release to manufacture
          </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.partName.trim()}>
          Submit part
        </Button>
      </div>
    </Panel>
  );
}
