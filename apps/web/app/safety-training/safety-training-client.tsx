"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { SAFETY_CATEGORIES, safetyCategoryLabel } from "../../lib/safety-training";
import type { SafetyTrainingView } from "../../lib/safety-training/compute-safety-training";
import type { SafetyCategory, SafetyCompletionStatus } from "../../lib/safety-training/types";

function statusTone(status: SafetyCompletionStatus): string {
  if (status === "current") return "good";
  if (status === "expiring_soon") return "setup";
  return "demo";
}

function statusLabel(status: SafetyCompletionStatus): string {
  if (status === "current") return "Current";
  if (status === "expiring_soon") return "Expiring soon";
  return "Expired";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SafetyTrainingView, { status: "live" }>;

export default function SafetyTrainingClient() {
  const [view, setView] = useState<SafetyTrainingView | null>(null);
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
    void fetch(`/api/safety-training${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SafetyTrainingView | { error?: string };
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
        const response = await fetch("/api/safety-training", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as SafetyTrainingView | { error?: string };
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
            {" / Safety Training"}
          </>
        }
        title="Safety Training"
        description="Track shop safety modules and per-member certification. Compliance uses only what you record."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Safety Training"
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
          <SummaryPanel view={view} />
          <CreateModuleForm busy={busy} mutate={mutate} />
          <ModulesList view={view} busy={busy} mutate={mutate} />
          <RecordCompletionForm view={view} busy={busy} mutate={mutate} />
          <CoverageTable view={view} />
          <CompletionsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Modules", value: String(summary.totalModules) },
    { label: "Required", value: String(summary.requiredModules) },
    { label: "Completions", value: String(summary.totalCompletions) },
    { label: "Compliant members", value: `${summary.compliantMemberCount}/${summary.memberCount}` },
    { label: "Compliance rate", value: pct(summary.complianceRate) },
    { label: "Expiring soon", value: String(summary.expiringSoonCount) },
    { label: "Expired", value: String(summary.expiredCount) },
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

function CreateModuleForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "shop_general" as SafetyCategory,
      description: "",
      isRequired: true,
      validityMonths: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);

  return (
    <Panel
      as="form"
      onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-module",
          title: form.title,
          category: form.category,
          description: form.description || undefined,
          isRequired: form.isRequired,
          validityMonths: form.validityMonths ? Number(form.validityMonths) : undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add safety module</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Table saw certification"
            required
          />
        </FormRow>
        <FormRow label="Category">
          <select
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as SafetyCategory }))}
          >
            {SAFETY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {safetyCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Renews every (months)">
          <input
            type="number"
            min={1}
            value={form.validityMonths}
            onChange={(e) => setForm((prev) => ({ ...prev, validityMonths: e.target.value }))}
            placeholder="Never expires"
          />
        </FormRow>
        <FormRow label="Required">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.isRequired}
              onChange={(e) => setForm((prev) => ({ ...prev, isRequired: e.target.checked }))}
            />
            Required for shop access
          </label>
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          rows={2}
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add module
        </button>
      </div>
    </Panel>
  );
}

function ModulesList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.modules.length === 0) {
    return (
      <EmptyState
        badge="No modules yet"
        badgeTone="setup"
        title="Add your first safety module"
        description="Table saw, mill, drill press, electrical, PPE — anything that requires sign-off before use."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Modules</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.modules.map((mod) => (
          <li key={mod.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{mod.title}</strong>
              {mod.isRequired ? <span className="app-badge demo" style={{ marginLeft: 8 }}>Required</span> : null}
              <small className="app-muted" style={{ display: "block" }}>
                {safetyCategoryLabel(mod.category)}
                {mod.validityMonths ? ` · renews every ${mod.validityMonths}mo` : " · no expiry"}
              </small>
              {mod.description ? <small className="app-muted">{mod.description}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${mod.title}"? This also removes its completion records.`)) {
                  mutate({ action: "delete-module", moduleId: mod.id });
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

function RecordCompletionForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      moduleId: view.modules[0]?.id ?? "",
      memberId: view.members[0]?.id ?? "",
      completedOn: "",
      certificateUrl: "",
      notes: "",
    }),
    [view.modules, view.members],
  );
  const [form, setForm] = useState(empty);

  if (view.modules.length === 0 || view.members.length === 0) return null;

  return (
    <Panel
      as="form"
      onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!form.moduleId || !form.memberId || !form.completedOn) return;
        mutate({
          action: "record-completion",
          moduleId: form.moduleId,
          memberId: form.memberId,
          completedOn: form.completedOn,
          certificateUrl: form.certificateUrl || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Record completion</h2>
      <FormGrid min={160}>
        <FormRow label="Module">
          <select value={form.moduleId} onChange={(e) => setForm((prev) => ({ ...prev, moduleId: e.target.value }))}>
            {view.modules.map((mod) => (
              <option key={mod.id} value={mod.id}>
                {mod.title}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Member">
          <select value={form.memberId} onChange={(e) => setForm((prev) => ({ ...prev, memberId: e.target.value }))}>
            {view.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Completed on">
          <input
            type="date"
            value={form.completedOn}
            onChange={(e) => setForm((prev) => ({ ...prev, completedOn: e.target.value }))}
            required
          />
        </FormRow>
        <FormRow label="Certificate URL (optional)">
          <input
            value={form.certificateUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, certificateUrl: e.target.value }))}
          />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.moduleId || !form.memberId || !form.completedOn}>
          Record completion
        </button>
      </div>
    </Panel>
  );
}

function CoverageTable({ view }: { view: LiveView }) {
  if (view.coverage.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Member coverage</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {view.coverage.map((row) => (
          <li key={row.memberId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span>{row.memberName}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`app-badge ${row.compliant ? "good" : "demo"}`}>
                {row.requiredCompleted}/{row.requiredTotal} required
              </span>
              {row.expiringSoonCount > 0 ? (
                <small className="app-muted">{row.expiringSoonCount} expiring soon</small>
              ) : null}
              {row.expiredCount > 0 ? <small className="app-muted">{row.expiredCount} expired</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CompletionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.completions.length === 0) {
    return (
      <EmptyState
        badge="No completions yet"
        badgeTone="setup"
        title="No completions recorded"
        description="Record a member's completion above once modules are set up."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Completion records</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.completions.slice(0, 50).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.memberName}</strong>
              <span className={`app-badge ${statusTone(item.status)}`} style={{ marginLeft: 8 }}>
                {statusLabel(item.status)}
              </span>
              <small className="app-muted" style={{ display: "block" }}>
                {item.moduleTitle} · completed {item.completedOn}
                {item.expiresOn ? ` · expires ${item.expiresOn}` : ""}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
              {item.certificateUrl ? (
                <small className="app-muted">
                  <a href={item.certificateUrl} target="_blank" rel="noreferrer">
                    Certificate
                  </a>
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete this completion for ${item.memberName}?`)) {
                  mutate({ action: "delete-completion", completionId: item.id });
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
