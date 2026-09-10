"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  COMMON_INPUTS,
  CONTROLLER_LABEL,
  CONTROLLERS,
  CONTROL_MODES,
  type ControlMode,
  type Controller,
} from "../../lib/control-map";
import {
  CONTROL_MAP_RELATED_INCLUDE,
  classifyControlMapShell,
  controlMapNextActions,
  controlMapRelatedLinks,
  controlMapShellCopy,
  formatControlMapMetric,
  type ControlMapNextAction,
  type ControlMapShellKind,
} from "../../lib/control-map/control-map-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./control-map.css";

type Binding = {
  id: string;
  controller: Controller;
  inputLabel: string;
  command: string;
  mode: ControlMode;
  notes: string;
  byName: string | null;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      bindings: Binding[];
      summary: { total: number; byController: Record<Controller, number> };
    };

type ReadyView = Extract<View, { status: "ready" }>;

const EMPTY_FORM = {
  controller: "driver" as Controller,
  inputLabel: "",
  command: "",
  mode: "teleop" as ControlMode,
  notes: "",
};

function ControlMapRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = controlMapRelatedLinks(orgId, { include: [...CONTROL_MAP_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related control-map-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ControlMapNextActionsPanel({ actions }: { actions: ControlMapNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions control-map-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ControlMapShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ControlMapShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = controlMapNextActions({ orgId, shell });
  const buildHref = hubHref("/build", "fmea", orgId);
  const copy = controlMapShellCopy(shell);
  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;

  return (
    <main className="module-page control-map-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Control Map"}
          </>
        }
        title="Control Map"
        description={description}
      >
        <ControlMapRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : failure
              ? failure.kind === "auth"
                ? "Signed out"
                : failure.kind === "forbidden"
                  ? "No access"
                  : "Unavailable"
              : shell === "empty"
                ? "No bindings yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && failure?.showRetry !== false ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Choose your team
          </a>
        ) : null}
      </EmptyState>
      <ControlMapNextActionsPanel actions={actions} />
    </main>
  );
}

export default function ControlMapClient({ orgId: orgIdProp }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setFetchFailed(false);
    setMessage("");
    setErrorStatus(null);
    try {
      const params = new URLSearchParams();
      params.set("seasonYear", String(seasonYear));
      if (orgIdProp) params.set("orgId", orgIdProp);
      const response = await fetch(`/api/control-map?${params.toString()}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !("status" in data)) {
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(data.error ?? "Failed to load control map");
        return;
      }
      setView(data);
    } catch {
      setFetchFailed(true);
      setMessage("Network error — please try again.");
    }
  }, [orgIdProp, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId =
    view?.status === "ready" ? view.context.orgId : orgIdProp;
  const bindingCount = view?.status === "ready" ? view.bindings.length : 0;
  const driverCount =
    view?.status === "ready" ? view.summary.byController.driver : 0;
  const operatorCount =
    view?.status === "ready" ? view.summary.byController.operator : 0;

  const shell = classifyControlMapShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "ready" ? view.context.orgId : orgIdProp,
    bindingCount,
  });
  const shellCopy = controlMapShellCopy(shell);
  const nextActions = controlMapNextActions({
    orgId,
    shell,
    bindingCount,
    driverCount,
    operatorCount,
  });
  const relatedLinks = controlMapRelatedLinks(orgId, {
    include: [...CONTROL_MAP_RELATED_INCLUDE],
  });
  const buildHref = hubHref("/build", "fmea", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready" || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/control-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      });
      const data = (await response.json()) as { error?: string };
      setMessage(response.ok ? okMessage : (data.error ?? "Request failed"));
      if (response.ok) await load();
    } catch {
      setMessage("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addBinding(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_binding", seasonYear, ...form }, "Binding saved.");
    setForm({ ...EMPTY_FORM, controller: form.controller });
  }

  if (shell === "loading") {
    return (
      <ControlMapShell
        description={shellCopy.description}
        orgId={orgIdProp}
        shell="loading"
      />
    );
  }

  if (shell === "error") {
    return (
      <ControlMapShell
        description={shellCopy.description}
        orgId={orgIdProp}
        shell="error"
        error={message || shellCopy.description}
        errorStatus={errorStatus}
        onRetry={() => void load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <ControlMapShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgIdProp}
        shell="setup"
      />
    );
  }

  if (view?.status !== "ready") {
    return (
      <ControlMapShell description={shellCopy.description} orgId={orgIdProp} shell="setup" />
    );
  }

  return (
    <main className="module-page control-map-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Control Map"}
          </>
        }
        title={`Control Map — ${seasonYear}`}
        description="Driver-station cheat sheet: every controller input → robot action. Keep it in sync with Subsystems and FMEA."
      >
        <div className="control-map-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      <ControlMapNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No bindings yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#control-map-form">
            Add first binding
          </a>
          <a className="app-button secondary" href={subsystemsHref}>
            Open Subsystems
          </a>
          <a className="app-button secondary" href={fmeaHref}>
            Open FMEA
          </a>
        </EmptyState>
      ) : null}

      <SummaryTiles view={view} loaded />

      <div className="control-map-layout">
        <AddBindingForm
          form={form}
          setForm={setForm}
          busy={busy}
          onSubmit={(event) => void addBinding(event)}
        />
        <Panel className="control-map-tip" aria-label="Drive-team tip">
          <span className="eyebrow">Drive-team cheat sheet</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Print this for the driver station so the drive team always knows which input does what.
            Cross-check{" "}
            <a href={subsystemsHref}>Subsystems</a> for mechanism names and{" "}
            <a href={fmeaHref}>FMEA</a> for high-risk actuators.
          </p>
        </Panel>
      </div>

      <BindingLists view={view} busy={busy} onDelete={(id) => void post({ action: "delete_binding", id }, "Binding removed.")} />
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: ReadyView; loaded: boolean }) {
  const s = view.summary;
  const tiles = [
    { label: "Bindings", value: formatControlMapMetric(s.total, loaded) },
    { label: "Driver", value: formatControlMapMetric(s.byController.driver, loaded) },
    { label: "Operator", value: formatControlMapMetric(s.byController.operator, loaded) },
    { label: "Other", value: formatControlMapMetric(s.byController.other, loaded) },
  ];
  return (
    <Panel className="control-map-coverage" aria-label="Control Map summary">
      <div className="control-map-stats">
        <div>
          <span className={`app-badge ${s.total === 0 ? "setup" : "good"}`}>
            {s.total === 0 ? "EMPTY" : "MAPPED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season map</h2>
          <small className="app-muted">Real bindings only.</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddBindingForm({
  form,
  setForm,
  busy,
  onSubmit,
}: {
  form: typeof EMPTY_FORM;
  setForm: (next: typeof EMPTY_FORM) => void;
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form
      id="control-map-form"
      className="app-card soft-panel control-map-form"
      onSubmit={onSubmit}
    >
      <h2 style={{ margin: 0 }}>Add a binding</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Real controller inputs and robot actions only.
      </p>
      <FormGrid>
        <FormRow label="Controller">
          <select
            value={form.controller}
            onChange={(e) => setForm({ ...form, controller: e.target.value as Controller })}
          >
            {CONTROLLERS.map((c) => (
              <option key={c} value={c}>
                {CONTROLLER_LABEL[c]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Mode">
          <select
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as ControlMode })}
          >
            {CONTROL_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Input" wide>
          <input
            required
            list="common-inputs"
            value={form.inputLabel}
            onChange={(e) => setForm({ ...form, inputLabel: e.target.value })}
            placeholder="Right trigger"
          />
          <datalist id="common-inputs">
            {COMMON_INPUTS.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </FormRow>
        <FormRow label="Action" wide>
          <input
            required
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            placeholder="Shoot"
          />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Hold while scoring"
          />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.inputLabel.trim() || !form.command.trim()}>
          Save binding
        </button>
      </div>
    </form>
  );
}

function BindingLists({
  view,
  busy,
  onDelete,
}: {
  view: ReadyView;
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  const groups = useMemo(
    () => CONTROLLERS.filter((c) => view.bindings.some((b) => b.controller === c)),
    [view.bindings],
  );

  if (groups.length === 0) return null;

  return (
    <div className="control-map-controller" aria-label="Bindings by controller">
      {groups.map((controller) => (
        <Panel key={controller}>
          <span className="eyebrow">{CONTROLLER_LABEL[controller]} controller</span>
          <ul className="control-map-list">
            {view.bindings
              .filter((b) => b.controller === controller)
              .map((b) => (
                <li key={b.id} className="app-card soft-panel control-map-card">
                  <div className="control-map-card-head">
                    <div>
                      <h3>
                        {b.inputLabel} → {b.command}
                      </h3>
                      <div className="control-map-card-meta">
                        <span className="app-badge setup">{b.mode}</span>
                        {b.notes ? <span className="app-muted">{b.notes}</span> : null}
                        {b.byName ? <span className="app-muted">· {b.byName}</span> : null}
                      </div>
                    </div>
                    {view.context.role !== "viewer" ? (
                      <div className="control-map-card-foot">
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy}
                          onClick={() => onDelete(b.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
