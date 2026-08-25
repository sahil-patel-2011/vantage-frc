"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { CHECKLIST_LIBRARY_CATEGORIES, checklistLibraryCategoryLabel } from "../../lib/checklist-library";
import type { ChecklistLibraryView } from "../../lib/checklist-library/compute-checklist-library";
import type { ChecklistLibraryCategory, ChecklistLibraryItem } from "../../lib/checklist-library/types";

type LiveView = Extract<ChecklistLibraryView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function ChecklistLibraryClient() {
  const [view, setView] = useState<ChecklistLibraryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/checklist-library${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ChecklistLibraryView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
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
        const response = await fetch("/api/checklist-library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ChecklistLibraryView | { error?: string };
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
            {" / Checklist Library"}
          </>
        }
        title="Checklist Library"
        description="Build reusable checklists for pit setup, transport, and event load-in, then run and check them off at every event."
      />

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
          <NewTemplateForm busy={busy} mutate={mutate} />
          <TemplatesPanel view={view} busy={busy} mutate={mutate} />
          <RunsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Templates", value: String(summary.totalTemplates) },
    { label: "Active", value: String(summary.activeTemplates) },
    { label: "Open runs", value: String(summary.openRuns) },
    { label: "Completed runs", value: String(summary.completedRuns) },
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
    </Panel>
  );
}

function TemplatesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [runLabels, setRunLabels] = useState<Record<string, string>>({});

  if (view.templates.length === 0) {
    return (
      <EmptyState
        badge="No templates yet"
        badgeTone="setup"
        title="Create your first checklist template"
        description="Pit setup, transport load-out, and competition load-in checklists all start as a named template with a list of items."
      />
    );
  }

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Templates</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.templates.map((template) => (
          <li key={template.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{template.name}</strong>
                {!template.active ? <span className="app-badge demo" style={{ marginLeft: 8 }}>Inactive</span> : null}
                <small className="app-muted" style={{ display: "block" }}>
                  {checklistLibraryCategoryLabel(template.category)} · {template.items.length} item(s)
                </small>
                {template.description ? <p className="app-muted" style={{ margin: "4px 0 0" }}>{template.description}</p> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "set-template-active", templateId: template.id, active: !template.active })}
                >
                  {template.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete template "${template.name}"?`)) {
                      mutate({ action: "delete-template", templateId: template.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
            <ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {template.items.map((item) => (
                <li key={item.key} className="app-badge demo">
                  {item.label}
                </li>
              ))}
            </ul>
            <form
              style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
              onSubmit={(event) => {
                event.preventDefault();
                const label = runLabels[template.id]?.trim();
                if (!label) return;
                mutate({ action: "start-run", templateId: template.id, label });
                setRunLabels((prev) => ({ ...prev, [template.id]: "" }));
              }}
            >
              <input
                placeholder="Run label (e.g. Week 3 Regional)"
                value={runLabels[template.id] ?? ""}
                onChange={(event) => setRunLabels((prev) => ({ ...prev, [template.id]: event.target.value }))}
              />
              <button type="submit" className="app-button secondary" disabled={busy || !(runLabels[template.id] ?? "").trim()}>
                Start run
              </button>
            </form>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RunsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.runs.length === 0) {
    return (
      <EmptyState
        badge="No runs yet"
        badgeTone="setup"
        title="Start a run from a template above"
        description="Each run tracks which items have been checked off so you can see completion at a glance."
      />
    );
  }

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Runs</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.runs.map((run) => {
          const checkedKeys = new Set(run.checkedItems.map((c) => c.key));
          return (
            <li key={run.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <strong>{run.label}</strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {run.templateName} · {checklistLibraryCategoryLabel(run.category)} · started {new Date(run.startedAt).toLocaleString()}
                  </small>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={`app-badge ${run.allDone ? "good" : "setup"}`}>{run.allDone ? "Complete" : pct(run.progress)}</span>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete run "${run.label}"?`)) {
                        mutate({ action: "delete-run", runId: run.id });
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {run.items.map((item: ChecklistLibraryItem) => {
                  const checked = checkedKeys.has(item.key);
                  return (
                    <li key={item.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={() =>
                            mutate({ action: "toggle-run-item", runId: run.id, itemKey: item.key, checked: !checked })
                          }
                        />
                        {item.label}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function NewTemplateForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      name: "",
      category: "pit" as ChecklistLibraryCategory,
      description: "",
      itemsText: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const items = useMemo(
    () =>
      form.itemsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label) => ({ label })),
    [form.itemsText],
  );

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim() || items.length === 0) return;
        mutate({
          action: "create-template",
          name: form.name,
          category: form.category,
          description: form.description || undefined,
          items,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>New checklist template</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Competition load-in" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {CHECKLIST_LIBRARY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {checklistLibraryCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <FormRow label="Items (one per line)">
        <textarea
          value={form.itemsText}
          onChange={set("itemsText")}
          rows={5}
          placeholder={"Totes loaded\nBatteries charged\nDrive station packed"}
          required
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim() || items.length === 0}>
          Create template
        </button>
      </div>
    </Panel>
  );
}
