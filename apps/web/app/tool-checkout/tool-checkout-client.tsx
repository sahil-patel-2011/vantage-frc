"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { toolCategoryLabel } from "../../lib/tool-checkout";
import { TOOL_CATEGORIES } from "../../lib/tool-checkout/compute-tool-checkout";
import type { ToolCheckoutView } from "../../lib/tool-checkout/compute-tool-checkout";
import type { ToolCategory, ToolCheckoutStatus } from "../../lib/tool-checkout/types";

type LiveView = Extract<ToolCheckoutView, { status: "live" }>;

const STATUS_LABEL: Record<ToolCheckoutStatus, string> = {
  available: "Available",
  checked_out: "Checked out",
  overdue: "Overdue",
};

const STATUS_TONE: Record<ToolCheckoutStatus, string> = {
  available: "good",
  checked_out: "setup",
  overdue: "demo",
};

export default function ToolCheckoutClient() {
  const [view, setView] = useState<ToolCheckoutView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/tool-checkout${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ToolCheckoutView | { error?: string };
        if (!response.ok || !("status" in data)) {
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
        const response = await fetch("/api/tool-checkout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ToolCheckoutView | { error?: string };
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
            {" / Tool Checkout"}
          </>
        }
        title="Tool Checkout"
        description="Track who has each shop tool and when it's due back — bus-factor protection for drills, calipers, chargers, and laptops."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load tool checkout"
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
          <AddToolForm busy={busy} mutate={mutate} />
          <ToolsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Tools tracked", value: String(summary.totalTools) },
    { label: "Available", value: String(summary.availableCount) },
    { label: "Checked out", value: String(summary.checkedOutCount) },
    { label: "Overdue", value: String(summary.overdueCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.byCategory.length > 0 ? (
        <small className="app-muted" style={{ display: "block", marginTop: 10 }}>
          {summary.byCategory
            .map((c) => `${toolCategoryLabel(c.category)}: ${c.checkedOut}/${c.total} out`)
            .join(" · ")}
        </small>
      ) : null}
    </Panel>
  );
}

function ToolsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.tools.length === 0) {
    return (
      <EmptyState
        badge="No tools yet"
        badgeTone="setup"
        title="Add your first shop tool"
        description="Register tools to track who has each one and when it's due back."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Tool registry</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.tools.map((tool) => (
          <li key={tool.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{tool.name}</strong>
              <span className={`app-badge ${STATUS_TONE[tool.status]}`} style={{ marginLeft: 8 }}>
                {STATUS_LABEL[tool.status]}
              </span>
              <small className="app-muted" style={{ display: "block" }}>
                {toolCategoryLabel(tool.category)}
                {tool.assetTag ? ` · ${tool.assetTag}` : ""}
                {tool.location ? ` · ${tool.location}` : ""}
              </small>
              {tool.currentLoan ? (
                <small className="app-muted" style={{ display: "block" }}>
                  With {tool.currentLoan.borrowerName}
                  {tool.currentLoan.dueAt
                    ? ` · due ${new Date(tool.currentLoan.dueAt).toLocaleDateString()}`
                    : ""}
                </small>
              ) : null}
              {tool.notes ? <small className="app-muted" style={{ display: "block" }}>{tool.notes}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {tool.currentLoan ? (
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => mutate({ action: "return-tool", loanId: tool.currentLoan!.id })}
                >
                  Return
                </button>
              ) : (
                <CheckoutButton toolId={tool.id} busy={busy} mutate={mutate} />
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "retire-tool", toolId: tool.id })}
              >
                Retire
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CheckoutButton({
  toolId,
  busy,
  mutate,
}: {
  toolId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [borrowerName, setBorrowerName] = useState("");
  const [dueAt, setDueAt] = useState("");

  if (!open) {
    return (
      <button type="button" className="app-button" disabled={busy} onClick={() => setOpen(true)}>
        Check out
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!borrowerName.trim()) return;
        mutate({
          action: "checkout-tool",
          toolId,
          borrowerName,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        });
        setBorrowerName("");
        setDueAt("");
        setOpen(false);
      }}
      style={{ display: "flex", gap: 6, alignItems: "center" }}
    >
      <input
        value={borrowerName}
        onChange={(event) => setBorrowerName(event.target.value)}
        placeholder="Borrower"
        required
        style={{ maxWidth: 120 }}
      />
      <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      <button type="submit" className="app-button" disabled={busy || !borrowerName.trim()}>
        Confirm
      </button>
      <button type="button" className="text-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function AddToolForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ name: "", category: "other" as ToolCategory, assetTag: "", location: "", notes: "" }),
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
        if (!form.name.trim()) return;
        mutate({
          action: "add-tool",
          name: form.name,
          category: form.category,
          assetTag: form.assetTag || undefined,
          location: form.location || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add tool</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Cordless drill" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {TOOL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {toolCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Asset tag (optional)">
          <input value={form.assetTag} onChange={set("assetTag")} placeholder="PT-014" />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} placeholder="Shop cabinet A" />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add tool
        </button>
      </div>
    </Panel>
  );
}
