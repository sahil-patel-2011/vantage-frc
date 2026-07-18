"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  codeVersionStatusLabel,
  wiringStatusLabel,
  CODE_VERSION_STATUSES,
  WIRING_STATUSES,
} from "../../lib/readiness-score";
import type { ReadinessScoreView } from "../../lib/readiness-score/compute-readiness-score";
import type {
  CodeVersionStatus,
  ReadinessFixCategory,
  ReadinessTier,
  WiringStatus,
} from "../../lib/readiness-score/types";

const CATEGORY_LABEL: Record<ReadinessFixCategory, string> = {
  fmea: "Open FMEA",
  wiring: "Wiring",
  code: "Code",
  bringup: "Bring-up checklist",
  weight: "Weight budget",
  power: "Power budget",
};

const COMPONENT_LABEL: Record<string, string> = {
  subsystemHealth: "Subsystem wiring",
  codeReadiness: "Code-version state",
  fmeaClearance: "FMEA clearance",
  weightHeadroom: "Weight headroom",
  powerHeadroom: "Power headroom",
  checklistCompletion: "Bring-up checklist",
};

function tierTone(tier: ReadinessTier): string {
  if (tier === "ready") return "good";
  if (tier === "at_risk") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ReadinessScoreView, { status: "live" }>;

export default function ReadinessScoreClient() {
  const [view, setView] = useState<ReadinessScoreView | null>(null);
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
    void fetch(`/api/readiness-score${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ReadinessScoreView | { error?: string };
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
        const response = await fetch("/api/readiness-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ReadinessScoreView | { error?: string };
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
            {" / Readiness Score"}
          </>
        }
        title="Robot Readiness Score"
        description="One grounded ship-readiness index across subsystem wiring/code state, weight & power headroom, the bring-up checklist, and open FMEA — with an ordered fix list."
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
          title="Could not load Readiness Score"
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
          <ReadinessPanel view={view} />
          <FixList view={view} />
          <SubsystemForm busy={busy} mutate={mutate} />
          <SubsystemList view={view} busy={busy} mutate={mutate} />
          <ChecklistPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { index } = view;
  const components = Object.entries(index.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Ship readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(index.tier)}`}>{index.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Ship-readiness index</h2>
          <small className="app-muted">
            {index.weightUsedLbs} / {index.weightBudgetLbs} lbs · {index.powerUsedAmps} / {index.powerBudgetAmps} A ·{" "}
            {index.checklistComplete}/{index.checklistTotal} checklist · {index.openFmeaCount} open FMEA
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(index.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "180px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FixList({ view }: { view: LiveView }) {
  const { fixList } = view.index;
  if (fixList.length === 0) {
    return (
      <EmptyState
        badge="Ship ready"
        badgeTone="good"
        title="No open fix-list items"
        description="Wiring is verified, code is deployed & tested, the bring-up checklist is complete, and there's no open FMEA or budget overrun on record."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Fix list — ordered by urgency</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {fixList.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {CATEGORY_LABEL[item.category]} · {item.reason}
              </small>
            </div>
            <span className="app-badge demo">Severity {item.severity}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SubsystemForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      name: "",
      weightLbs: "",
      powerDrawAmps: "",
      wiringStatus: "not_started" as WiringStatus,
      codeVersionStatus: "stale" as CodeVersionStatus,
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
        if (!form.name.trim()) return;
        mutate({
          action: "save-subsystem",
          name: form.name,
          weightLbs: Number(form.weightLbs) || 0,
          powerDrawAmps: Number(form.powerDrawAmps) || 0,
          wiringStatus: form.wiringStatus,
          codeVersionStatus: form.codeVersionStatus,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log / update subsystem</h2>
      <FormGrid min={160}>
        <FormRow label="Subsystem name">
          <input value={form.name} onChange={set("name")} placeholder="Drivetrain" required />
        </FormRow>
        <FormRow label="Weight (lbs)">
          <input type="number" min={0} step="0.1" value={form.weightLbs} onChange={set("weightLbs")} />
        </FormRow>
        <FormRow label="Power draw (A)">
          <input type="number" min={0} step="0.1" value={form.powerDrawAmps} onChange={set("powerDrawAmps")} />
        </FormRow>
        <FormRow label="Wiring status">
          <select value={form.wiringStatus} onChange={set("wiringStatus")}>
            {WIRING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {wiringStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Code-version status">
          <select value={form.codeVersionStatus} onChange={set("codeVersionStatus")}>
            {CODE_VERSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {codeVersionStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Save subsystem
        </button>
      </div>
    </Panel>
  );
}

function SubsystemList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.subsystems.length === 0) {
    return (
      <EmptyState
        badge="No subsystems yet"
        badgeTone="setup"
        title="Log your first subsystem"
        description="Weight, power draw, wiring, and code-version state per subsystem ground the readiness index."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Subsystems</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.subsystems.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.weightLbs} lbs · {item.powerDrawAmps} A · {wiringStatusLabel(item.wiringStatus)} ·{" "}
                {codeVersionStatusLabel(item.codeVersionStatus)} · health {pct(item.healthScore)}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove "${item.name}"?`)) {
                  mutate({ action: "delete-subsystem", subsystemId: item.id });
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChecklistPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState("");
  const [subsystemName, setSubsystemName] = useState("");

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Bring-up checklist</h2>
      {view.checklistItems.length === 0 ? (
        <p className="app-muted">No checklist items logged yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, marginBottom: 12 }}>
          {view.checklistItems.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={item.isComplete}
                  disabled={busy}
                  onChange={(event) =>
                    mutate({ action: "toggle-checklist-item", itemId: item.id, isComplete: event.target.checked })
                  }
                />
                <span style={{ textDecoration: item.isComplete ? "line-through" : "none" }}>{item.label}</span>
                {item.subsystemName ? <small className="app-muted">— {item.subsystemName}</small> : null}
              </label>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "delete-checklist-item", itemId: item.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim()) return;
          mutate({
            action: "add-checklist-item",
            label,
            subsystemName: subsystemName || undefined,
            sequence: view.checklistItems.length,
          });
          setLabel("");
          setSubsystemName("");
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <FormRow label="New checklist item">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Confirm bumper height" />
        </FormRow>
        <FormRow label="Subsystem (optional)">
          <input value={subsystemName} onChange={(event) => setSubsystemName(event.target.value)} />
        </FormRow>
        <button type="submit" className="app-button secondary" disabled={busy || !label.trim()}>
          Add item
        </button>
      </form>
    </Panel>
  );
}
