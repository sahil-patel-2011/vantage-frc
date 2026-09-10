"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { SEASON_ROLLOVER_CATEGORIES, seasonRolloverCategoryLabel } from "../../lib/season-rollover";
import type { SeasonRolloverView } from "../../lib/season-rollover/compute-season-rollover";
import type { SeasonRolloverCategory } from "../../lib/season-rollover/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SeasonRolloverView, { status: "live" }>;

export default function SeasonRolloverClient() {
  const [view, setView] = useState<SeasonRolloverView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((toSeasonYearOverride?: number) => {
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (toSeasonYearOverride) query.set("toSeasonYear", String(toSeasonYearOverride));
    void fetch(`/api/season-rollover${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SeasonRolloverView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailureStatus(response.status);
          setFailureMessage("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
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
        const response = await fetch("/api/season-rollover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as SeasonRolloverView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Season Rollover"}
          </>
        }
        title="Season Rollover"
        description="Archive a completed season and track the roster, config, and scouting-schema items you carry forward into the next season year."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: failureStatus,
              message: failureMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message:
                failureMessage || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => load()}>
                  Retry
                </Button>
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
          <PlanPanel view={view} mutate={mutate} busy={busy} load={load} />
          {view.activePlan ? (
            <>
              <SummaryTiles view={view} />
              <AddItemForm busy={busy} mutate={mutate} planId={view.activePlan.id} />
              <ItemList view={view} busy={busy} mutate={mutate} />
            </>
          ) : (
            <EmptyState
              badge="No plan yet"
              badgeTone="setup"
              title="Create a rollover plan to get started"
              description="A plan archives the current season and tracks what you carry into the next one."
            />
          )}
        </div>
      )}
    </main>
  );
}

function PlanPanel({
  view,
  mutate,
  busy,
  load,
}: {
  view: LiveView;
  mutate: (payload: Record<string, unknown>) => void;
  busy: boolean;
  load: (toSeasonYearOverride?: number) => void;
}) {
  const [fromYear, setFromYear] = useState(String(view.fromSeasonYear));
  const [toYear, setToYear] = useState(String(view.toSeasonYear));
  const [notes, setNotes] = useState("");

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {view.activePlan
              ? `${view.activePlan.fromSeasonYear} → ${view.activePlan.toSeasonYear}`
              : "No active plan"}
          </h2>
          {view.activePlan ? (
            <small className="app-muted">
              Status: {view.activePlan.status}
              {view.activePlan.completedAt ? ` · completed ${view.activePlan.completedAt.slice(0, 10)}` : ""}
            </small>
          ) : null}
        </div>
        {view.plans.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Plan
            <select
              value={view.activePlan?.toSeasonYear ?? view.toSeasonYear}
              onChange={(event) => load(Number(event.target.value))}
            >
              {view.plans.map((plan) => (
                <option key={plan.id} value={plan.toSeasonYear}>
                  {plan.fromSeasonYear} → {plan.toSeasonYear} ({plan.status})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {view.activePlan && view.activePlan.status !== "completed" ? (
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" type="button" disabled={busy} onClick={() => mutate({ action: "complete-plan", planId: view.activePlan!.id })}>
            Mark rollover complete
          </Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => { if (window.confirm("Delete this rollover plan and its items?")) { mutate({ action: "delete-plan", planId: view.activePlan!.id }); } }}>
            Delete plan
          </Button>
        </div>
      ) : null}

      <form
        style={{ marginTop: 16, display: "grid", gap: 10, borderTop: "1px solid var(--app-border, #2a2f3a)", paddingTop: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          const from = Number(fromYear);
          const to = Number(toYear);
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
          mutate({ action: "create-plan", fromSeasonYear: from, toSeasonYear: to, notes: notes || undefined });
          setNotes("");
        }}
      >
        <h3 style={{ margin: 0 }}>Start a new rollover</h3>
        <FormGrid min={140}>
          <FormRow label="From season">
            <input type="number" value={fromYear} onChange={(e) => setFromYear(e.target.value)} />
          </FormRow>
          <FormRow label="To season">
            <input type="number" value={toYear} onChange={(e) => setToYear(e.target.value)} />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </FormRow>
        <div>
          <Button variant="secondary" type="submit" disabled={busy}>
            Create plan
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Items", value: String(summary.totalItems) },
    { label: "Carried forward", value: String(summary.carriedItems) },
    { label: "Completion", value: pct(summary.completionRate) },
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
      {summary.byCategory.length > 0 ? (
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{seasonRolloverCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.carried} / {row.total} carried
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function ItemList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const items = view.activePlan?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        badge="No items yet"
        badgeTone="setup"
        title="Add your first carry-forward item"
        description="Roster, team config, and scouting schema items you want in the next season."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Carry-forward checklist</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {items.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={item.carried}
                  disabled={busy}
                  onChange={(e) => mutate({ action: "set-item-carried", itemId: item.id, carried: e.target.checked })}
                />
                <strong>{item.label}</strong>
              </label>
              <small className="app-muted" style={{ display: "block", marginLeft: 24 }}>
                {seasonRolloverCategoryLabel(item.category)}
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.label}"?`)) {
                  mutate({ action: "delete-item", itemId: item.id });
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

function AddItemForm({
  busy,
  mutate,
  planId,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  planId: string;
}) {
  const empty = useMemo(
    () => ({
      label: "",
      category: "roster" as SeasonRolloverCategory,
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
        if (!form.label.trim()) return;
        mutate({
          action: "add-item",
          planId,
          label: form.label,
          category: form.category,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add carry-forward item</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input value={form.label} onChange={set("label")} placeholder="2026 scouting form fields" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {SEASON_ROLLOVER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {seasonRolloverCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.label.trim()}>
          Add item
        </Button>
      </div>
    </Panel>
  );
}
