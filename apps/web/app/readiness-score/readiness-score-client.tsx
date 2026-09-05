"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  StatRowSkeleton,
  StatTile,
  TableSkeleton,
  type BadgeTone,
} from "../../components/ui";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import {
  codeVersionStatusLabel,
  wiringStatusLabel,
  CODE_VERSION_STATUSES,
  WIRING_STATUSES,
} from "../../lib/readiness-score";
import type { ReadinessScoreView } from "../../lib/readiness-score/compute-readiness-score";
import {
  classifyReadinessScoreShell,
  formatReadinessScoreMetric,
  formatReadinessScorePercent,
  readinessScoreShellCopy,
  type ReadinessScoreShellKind,
} from "../../lib/readiness-score/readiness-score-related";
import type {
  CodeVersionStatus,
  ReadinessFixCategory,
  ReadinessTier,
  WiringStatus,
} from "../../lib/readiness-score/types";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./readiness-score.css";

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

function tierTone(tier: ReadinessTier): BadgeTone {
  if (tier === "ready") return "good";
  if (tier === "at_risk") return "setup";
  return "danger";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ReadinessScoreView, { status: "live" }>;

function ReadinessShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  shell: ReadinessScoreShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const copy = readinessScoreShellCopy(shell);

  return (
    <main className="module-page readiness-score-page soft-gate">
      <PageHeader
        breadcrumbs="Build / Readiness Score"
        title="Robot readiness score"
        description={description}
      />
      {shell === "loading" ? (
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading readiness score">
          <StatRowSkeleton count={4} />
          <TableSkeleton rows={4} cols={3} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : shell === "empty" ? "No subsystems yet" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <a className="app-button" href="#readiness-score-subsystem">
              Log a subsystem
            </a>
          ) : null}
        </EmptyState>
      )}
    </main>
  );
}

export default function ReadinessScoreClient() {
  const [view, setView] = useState<ReadinessScoreView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const subsystemCount = view?.status === "live" ? view.subsystems.length : 0;

  const shell = classifyReadinessScoreShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    subsystemCount,
  });
  const shellCopy = readinessScoreShellCopy(shell);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/readiness-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ReadinessScoreView | { error?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
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

  if (shell === "loading") {
    return <ReadinessShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <ReadinessShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <ReadinessShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <ReadinessShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page readiness-score-page">
      <PageHeader
        breadcrumbs="Build / Readiness Score"
        title="Robot readiness score"
        description="One grounded ship-readiness index across subsystem wiring/code state, weight & power headroom, the bring-up checklist, and open FMEA. Cross-check FMEA, Inspection, and Code — never DEMO readiness metrics."
      >
        <div className="readiness-score-header-actions">
          {view.seasons.length > 0 ? (
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
        </div>
      </PageHeader>

      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {subsystemCount > 0 ? (
        <Panel className="readiness-score-panel" aria-label="Readiness counts">
          <div className="readiness-score-stats">
            <StatTile
              label="Subsystems"
              value={formatReadinessScoreMetric(subsystemCount, true)}
            />
            <StatTile
              label="Ship index"
              value={formatReadinessScorePercent(view.index.score, true)}
            />
            <StatTile
              label="Open FMEA"
              value={formatReadinessScoreMetric(view.index.openFmeaCount, true)}
            />
            <StatTile
              label="Checklist"
              value={`${formatReadinessScoreMetric(view.index.checklistComplete, true)}/${formatReadinessScoreMetric(view.index.checklistTotal, true)}`}
            />
          </div>
        </Panel>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No subsystems yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <a className="app-button" href="#readiness-score-subsystem">
            Log a subsystem
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {subsystemCount > 0 ? <ReadinessPanel view={view} /> : null}
        {subsystemCount > 0 ? <FixList view={view} /> : null}
        <SubsystemForm busy={busy} mutate={mutate} cutoffCode={cutoffCode} orgId={orgId} />
        <SubsystemList view={view} busy={busy} mutate={mutate} />
        <ChecklistPanel view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { index } = view;
  const components = Object.entries(index.components) as Array<[string, number]>;
  return (
    <Panel className="readiness-score-panel" aria-label="Ship readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Badge tone={tierTone(index.tier)}>{index.tier.replace("_", " ").toUpperCase()}</Badge>
          <h2 style={{ margin: "6px 0 0" }}>Ship-readiness index</h2>
          <small className="app-muted">
            {index.weightUsedLbs} / {index.weightBudgetLbs} lbs · {index.powerUsedAmps} / {index.powerBudgetAmps} A ·{" "}
            {index.checklistComplete}/{index.checklistTotal} checklist · {index.openFmeaCount} open FMEA. Weight/power
            use a default 115 lb / 120 A yardstick until you record budgets — not a measured weigh-in. Never DEMO
            scores
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{formatReadinessScorePercent(index.score, true)}</strong>
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
        soft
        badge="Ship ready"
        badgeTone="good"
        title="No open fix-list items"
        description="Wiring is verified, code is deployed & tested, the bring-up checklist is complete, and there's no open FMEA or budget overrun on record — never DEMO severity."
      />
    );
  }
  return (
    <Panel id="readiness-score-fixes" className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Fix list — ordered by urgency</h2>
      <p className="app-muted">From logged subsystems and open FMEA only — never DEMO severity.</p>
      <ul className="readiness-score-list">
        {fixList.map((item) => (
          <li key={item.id} className="readiness-score-row">
            <div>
              <strong>{item.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {CATEGORY_LABEL[item.category]} · {item.reason}
              </small>
            </div>
            <Badge tone="danger">Severity {item.severity}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SubsystemForm({
  busy,
  mutate,
  cutoffCode,
  orgId,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  cutoffCode: string | null;
  orgId: string | null;
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
      id="readiness-score-subsystem"
      as="form"
      className="readiness-score-panel"
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
      <p className="app-muted" style={{ margin: 0 }}>
        Metered local health scoring — UsageCutoffBanner appears when budgets hard-stop. Never DEMO readiness.
      </p>
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
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
    return null;
  }
  return (
    <Panel className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Subsystems</h2>
      <ul className="readiness-score-list">
        {view.subsystems.map((item) => (
          <li key={item.id} className="readiness-score-row">
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
    <Panel className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Bring-up checklist</h2>
      {view.checklistItems.length === 0 ? (
        <p className="app-muted">No checklist items logged yet — never DEMO completion.</p>
      ) : (
        <ul className="readiness-score-list" style={{ marginBottom: 12 }}>
          {view.checklistItems.map((item) => (
            <li key={item.id} className="readiness-score-row">
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
