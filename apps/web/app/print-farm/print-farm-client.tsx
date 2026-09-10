"use client";

// 3D Print Farm — deliberately small, honest, and MANUAL.
// Non-goals (also stated in migration 0473): no slicer integration, no G-code upload,
// no printer telemetry, no OctoPrint/Bambu/Prusa API. Printer status is human-reported
// and always shown with how long ago it was reported. Every derived number (ETA, bias,
// runway, failure rate) is null with a named reason below its sample threshold.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  ProgressMeter,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import {
  FAILURE_REASONS,
  FILAMENT_MATERIALS,
  JOB_PRIORITIES,
  JOB_PURPOSES,
  PRINTER_STATUSES,
  failureReasonLabel,
  materialLabel,
  purposeLabel,
  reportedAgoLabel,
} from "../../lib/print-farm";
import type {
  FilamentView,
  JobView,
  PrintFarmView,
  PrinterView,
} from "../../lib/print-farm/compute-print-farm";
import type {
  FailureReason,
  FilamentMaterial,
  JobPriority,
  JobPurpose,
  JobStatus,
  PrinterStatus,
} from "../../lib/print-farm/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./print-farm.css";

type LiveView = Extract<PrintFarmView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  printing: "Printing",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const JOB_STATUS_TONE: Record<JobStatus, BadgeTone> = {
  queued: "neutral",
  printing: "info",
  paused: "setup",
  done: "good",
  failed: "danger",
  cancelled: "neutral",
};

const PRINTER_STATUS_LABEL: Record<PrinterStatus, string> = {
  idle: "Idle",
  printing: "Printing",
  paused: "Paused",
  maintenance: "Maintenance",
  offline: "Offline",
  retired: "Retired",
};

const PRIORITY_LABEL: Record<JobPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

function NonGoalsNote() {
  return (
    <p className="app-muted pf-nongoals">
      Manual by design: no slicer integration, no G-code upload, no printer telemetry, no
      OctoPrint/Bambu/Prusa API. Printer status is what a teammate last reported — nothing here is
      live machine data.
    </p>
  );
}

function FarmShell({
  description,
  orgId,
  kind,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  kind: "loading" | "error" | "setup";
  error?: string;
  onRetry?: () => void;
}) {
  const buildHref = hubWorkbenchHref("build", "print-farm", orgId);
  return (
    <main className="module-page pf-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Print Farm"}
          </>
        }
        title="3D Print Farm"
        description={description}
      />
      {kind === "loading" ? (
        <div aria-busy="true" aria-label="Loading the Print Farm">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : kind === "error" ? (
        <ErrorState message={error ?? "Could not load the Print Farm."} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Select a team"
          description={description}
        >
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Choose your team
          </a>
        </EmptyState>
      )}
      <NonGoalsNote />
    </main>
  );
}

export default function PrintFarmClient() {
  const [view, setView] = useState<PrintFarmView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/print-farm${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PrintFarmView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;

  const mutate = useCallback<Mutate>(
    async (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/print-farm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as PrintFarmView | { error?: string };
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

  if (view == null && !fetchFailed) {
    return <FarmShell description="Queue prints, report printer status, and track filament by hand." kind="loading" />;
  }
  if (fetchFailed) {
    return (
      <FarmShell
        description="Queue prints, report printer status, and track filament by hand."
        orgId={orgId}
        kind="error"
        error="Could not load the Print Farm."
        onRetry={() => load()}
      />
    );
  }
  if (view == null || view.status !== "live") {
    return (
      <FarmShell
        description={view?.status === "setup_required" ? view.message : "Select a team to run the print farm."}
        orgId={orgId}
        kind="setup"
      />
    );
  }

  const buildHref = hubWorkbenchHref("build", "print-farm", orgId);
  const hasAnything =
    view.summary.printerCount > 0 || view.summary.spoolCount > 0 || view.queue.length > 0 || view.recentFinished.length > 0;

  return (
    <main className="module-page pf-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Print Farm"}
          </>
        }
        title="3D Print Farm"
        description="Queue prints, report printer status, and track filament by hand — nothing here is live machine data."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {hasAnything ? (
        <Panel className="pf-panel">
          <div className="pf-stats">
            <StatTile label="Queued" value={String(view.summary.queuedCount)} />
            <StatTile label="Printing" value={String(view.summary.printingCount)} />
            <StatTile label="At risk" value={String(view.summary.atRiskCount)} />
            <StatTile label="Needs estimate" value={String(view.summary.needsEstimateCount)} />
            <StatTile label="Printers" value={String(view.summary.activePrinterCount)} />
            <StatTile label="Filament left" value={`${Math.round(view.summary.gramsRemainingTotal)} g`} />
          </div>
          {view.estimateBias.value != null ? (
            <p className="app-muted pf-block">
              Estimates run about ×{view.estimateBias.value.toFixed(2)} vs. actual (median of{" "}
              {view.estimateBias.sampleSize} completed jobs). ETAs below use this multiplier.
            </p>
          ) : (
            <p className="app-muted pf-block">Estimate bias not computed yet — {view.estimateBias.reason}.</p>
          )}
        </Panel>
      ) : null}

      <QueueJobForm view={view} busy={busy} mutate={mutate} />
      <QueuePanel view={view} busy={busy} mutate={mutate} />
      <PrintersPanel view={view} busy={busy} mutate={mutate} />
      <FilamentPanel view={view} busy={busy} mutate={mutate} />
      <RecentFinishedPanel view={view} />
      <NonGoalsNote />
    </main>
  );
}

// ---------------------------------------------------------------- queue a print (primary action)

function QueueJobForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      partName: "",
      quantity: "1",
      purpose: "competition_robot" as JobPurpose,
      priority: "normal" as JobPriority,
      subsystemName: "",
      printerId: "",
      filamentId: "",
      estimatedMinutes: "",
      estimatedGrams: "",
      neededBy: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="print-farm-queue-job"
      className="pf-panel"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.partName.trim()) return;
        mutate({
          action: "queue-job",
          partName: form.partName,
          quantity: form.quantity ? Number(form.quantity) : 1,
          purpose: form.purpose,
          priority: form.priority,
          subsystemName: form.subsystemName || undefined,
          printerId: form.printerId || undefined,
          filamentId: form.filamentId || undefined,
          estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : undefined,
          estimatedGrams: form.estimatedGrams ? Number(form.estimatedGrams) : undefined,
          neededBy: form.neededBy || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Queue a print</h2>
      <p className="app-muted pf-block">
        Time and filament estimates are yours from the slicer — jobs without one are excluded from
        every ETA, never guessed.
      </p>
      <FormGrid min={160}>
        <FormRow label="Part name">
          <input value={form.partName} onChange={set("partName")} placeholder="Intake roller spacer" required />
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={1} value={form.quantity} onChange={set("quantity")} />
        </FormRow>
        <FormRow label="Purpose">
          <select value={form.purpose} onChange={set("purpose")}>
            {JOB_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {purposeLabel(purpose)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {JOB_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem (optional)">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Intake" />
        </FormRow>
        <FormRow label="Printer (optional)">
          <select value={form.printerId} onChange={set("printerId")}>
            <option value="">Any printer</option>
            {view.printers
              .filter((printer) => printer.active)
              .map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.name}
                </option>
              ))}
          </select>
        </FormRow>
        <FormRow label="Filament (optional)">
          <select value={form.filamentId} onChange={set("filamentId")}>
            <option value="">Not chosen yet</option>
            {view.filaments.map((filament) => (
              <option key={filament.id} value={filament.id}>
                {spoolLabel(filament)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Est. minutes (from slicer, optional)">
          <input type="number" min={1} value={form.estimatedMinutes} onChange={set("estimatedMinutes")} />
        </FormRow>
        <FormRow label="Est. grams (from slicer, optional)">
          <input type="number" min={1} value={form.estimatedGrams} onChange={set("estimatedGrams")} />
        </FormRow>
        <FormRow label="Needed by (optional)">
          <input type="date" value={form.neededBy} onChange={set("neededBy")} />
        </FormRow>
      </FormGrid>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !form.partName.trim()}>
          Queue a print
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- queue

function jobSubtitle(job: JobView, view: LiveView): string {
  const printer = job.printerId ? view.printers.find((p) => p.id === job.printerId)?.name : null;
  const pieces = [
    `×${job.quantity}`,
    purposeLabel(job.purpose),
    PRIORITY_LABEL[job.priority],
    job.subsystemName ?? undefined,
    printer ? `on ${printer}` : "no printer yet",
    job.neededBy ? `needed by ${job.neededBy}` : undefined,
  ].filter(Boolean);
  return pieces.join(" · ");
}

function QueuePanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [failingId, setFailingId] = useState<string | null>(null);

  if (view.queue.length === 0) {
    return (
      <EmptyState
        soft
        badge="Queue is empty"
        badgeTone="setup"
        title="No prints queued"
        description="Queue a print above — part name is all that's required; estimates make the ETA honest."
      />
    );
  }

  return (
    <Panel id="print-farm-queue" className="pf-panel">
      <h2>Queue</h2>
      <ul className="pf-list">
        {view.queue.map((job) => (
          <li key={job.id} className="pf-row">
            <div className="pf-row-main">
              <div>
                <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>{" "}
                {job.atRisk ? <Badge tone="danger">At risk</Badge> : null}{" "}
                {job.needsEstimate ? <Badge tone="setup">Needs estimate</Badge> : null}
              </div>
              <strong className="pf-name">{job.partName}</strong>
              <small className="app-muted pf-block">{jobSubtitle(job, view)}</small>
              <small className="app-muted pf-block">
                {job.needsEstimate
                  ? "No time estimate — excluded from the ETA until one is added."
                  : job.projectedFinishAt
                    ? `Projected finish ${new Date(job.projectedFinishAt).toLocaleString()}`
                    : "No projection — assign a printer to get an ETA."}
              </small>
            </div>
            <div className="pf-actions">
              {job.status === "queued" && !job.assignedTo ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  aria-label={`Claim ${job.partName}`}
                  onClick={() => mutate({ action: "claim-job", jobId: job.id })}
                >
                  Claim
                </Button>
              ) : null}
              {job.status === "queued" && job.assignedTo ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  aria-label={`Start ${job.partName}`}
                  onClick={() => mutate({ action: "start-job", jobId: job.id })}
                >
                  Start
                </Button>
              ) : null}
              {job.status === "printing" || job.status === "paused" ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    aria-label={`Mark ${job.partName} done`}
                    onClick={() => {
                      setFinishingId(finishingId === job.id ? null : job.id);
                      setFailingId(null);
                    }}
                  >
                    Done
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    aria-label={`Mark ${job.partName} failed`}
                    onClick={() => {
                      setFailingId(failingId === job.id ? null : job.id);
                      setFinishingId(null);
                    }}
                  >
                    Failed
                  </Button>
                </>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Cancel ${job.partName}`}
                onClick={() => {
                  if (window.confirm(`Cancel "${job.partName}"?`)) {
                    mutate({ action: "cancel-job", jobId: job.id });
                  }
                }}
              >
                Cancel
              </Button>
            </div>
            {finishingId === job.id ? (
              <FinishJobForm
                job={job}
                busy={busy}
                onSubmit={(payload) => {
                  setFinishingId(null);
                  mutate(payload);
                }}
                onDismiss={() => setFinishingId(null)}
              />
            ) : null}
            {failingId === job.id ? (
              <FailJobForm
                job={job}
                busy={busy}
                onSubmit={(payload) => {
                  setFailingId(null);
                  mutate(payload);
                }}
                onDismiss={() => setFailingId(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function FinishJobForm({
  job,
  busy,
  onSubmit,
  onDismiss,
}: {
  job: JobView;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onDismiss: () => void;
}) {
  const [actualMinutes, setActualMinutes] = useState("");
  const [actualGrams, setActualGrams] = useState("");
  return (
    <form
      className="pf-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          action: "finish-job",
          jobId: job.id,
          actualMinutes: actualMinutes ? Number(actualMinutes) : undefined,
          actualGrams: actualGrams ? Number(actualGrams) : undefined,
        });
      }}
    >
      <label>
        Actual minutes (optional)
        <input type="number" min={1} value={actualMinutes} onChange={(e) => setActualMinutes(e.target.value)} />
      </label>
      <label>
        Grams used (optional — decrements the spool)
        <input type="number" min={1} value={actualGrams} onChange={(e) => setActualGrams(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        Confirm done
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Back
      </Button>
    </form>
  );
}

function FailJobForm({
  job,
  busy,
  onSubmit,
  onDismiss,
}: {
  job: JobView;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onDismiss: () => void;
}) {
  const [failureReason, setFailureReason] = useState<FailureReason>("other");
  const [actualMinutes, setActualMinutes] = useState("");
  const [wastedGrams, setWastedGrams] = useState("");
  return (
    <form
      className="pf-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          action: "fail-job",
          jobId: job.id,
          failureReason,
          actualMinutes: actualMinutes ? Number(actualMinutes) : undefined,
          wastedGrams: wastedGrams ? Number(wastedGrams) : undefined,
        });
      }}
    >
      <label>
        Failure reason
        <select value={failureReason} onChange={(e) => setFailureReason(e.target.value as FailureReason)}>
          {FAILURE_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {failureReasonLabel(reason)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Minutes run (optional)
        <input type="number" min={1} value={actualMinutes} onChange={(e) => setActualMinutes(e.target.value)} />
      </label>
      <label>
        Grams wasted (optional — decrements the spool)
        <input type="number" min={1} value={wastedGrams} onChange={(e) => setWastedGrams(e.target.value)} />
      </label>
      <Button type="submit" variant="danger" size="sm" disabled={busy}>
        Confirm failed
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Back
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- printers

function PrintersPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  return (
    <Panel id="print-farm-printers" className="pf-panel">
      <h2>Printers</h2>
      <p className="app-muted pf-block">
        Status is human-reported — update it when you walk past the machine. It is never live.
      </p>
      {view.printers.length === 0 ? (
        <EmptyState
          soft
          badge="No printers yet"
          badgeTone="setup"
          title="Add your first printer"
          description="Name is all that's required; build volume and nozzle help teammates pick a machine."
        />
      ) : (
        <ul className="pf-list">
          {view.printers.map((printer) => (
            <PrinterRow key={printer.id} printer={printer} view={view} busy={busy} mutate={mutate} />
          ))}
        </ul>
      )}
      <AddPrinterForm busy={busy} mutate={mutate} />
    </Panel>
  );
}

function PrinterRow({
  printer,
  view,
  busy,
  mutate,
}: {
  printer: PrinterView;
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  const loaded = printer.loadedFilamentId
    ? view.filaments.find((f) => f.id === printer.loadedFilamentId)
    : null;
  const scheduled = printer.schedule.entries.filter((entry) => !entry.needsEstimate);
  const lastFinish = scheduled[scheduled.length - 1]?.projectedFinishAt ?? null;
  return (
    <li className="pf-row">
      <div className="pf-row-main">
        <div>
          <Badge tone={printer.active ? "neutral" : "setup"}>
            {PRINTER_STATUS_LABEL[printer.status]}
          </Badge>{" "}
          <small className="app-muted">{reportedAgoLabel(printer.statusUpdatedAt, view.computedAt)}</small>
        </div>
        <strong className="pf-name">{printer.name}</strong>
        <small className="app-muted pf-block">
          {[
            printer.model ?? undefined,
            printer.nozzleMm != null ? `${printer.nozzleMm}mm nozzle` : undefined,
            printer.buildXMm != null && printer.buildYMm != null && printer.buildZMm != null
              ? `${printer.buildXMm}×${printer.buildYMm}×${printer.buildZMm}mm`
              : undefined,
            loaded ? `loaded: ${spoolLabel(loaded)}` : "no filament loaded",
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <small className="app-muted pf-block">
          {printer.failureRate.value != null
            ? `Failure rate ${(printer.failureRate.value * 100).toFixed(0)}% over ${printer.failureRate.sampleSize} finished jobs`
            : `Failure rate not computed — ${printer.failureRate.reason}`}
          {lastFinish
            ? ` · queue clears ~${new Date(lastFinish).toLocaleString()}`
            : ""}
          {printer.schedule.excludedForNoEstimate > 0
            ? ` · ${printer.schedule.excludedForNoEstimate} job(s) excluded from ETA (no estimate)`
            : ""}
        </small>
      </div>
      <div className="pf-actions">
        <label className="app-muted">
          Report status{" "}
          <select
            value={printer.status}
            disabled={busy}
            aria-label={`Report status for ${printer.name}`}
            onChange={(event) =>
              mutate({ action: "set-printer-status", printerId: printer.id, status: event.target.value })
            }
          >
            {PRINTER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PRINTER_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted">
          Load spool{" "}
          <select
            value={printer.loadedFilamentId ?? ""}
            disabled={busy}
            aria-label={`Loaded filament for ${printer.name}`}
            onChange={(event) =>
              mutate({ action: "load-filament", printerId: printer.id, filamentId: event.target.value || null })
            }
          >
            <option value="">None</option>
            {view.filaments.map((filament) => (
              <option key={filament.id} value={filament.id}>
                {spoolLabel(filament)}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={printer.active ? `Retire ${printer.name}` : `Reactivate ${printer.name}`}
          onClick={() => mutate({ action: "update-printer", printerId: printer.id, active: !printer.active })}
        >
          {printer.active ? "Retire" : "Reactivate"}
        </Button>
      </div>
    </li>
  );
}

function AddPrinterForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ name: "", model: "", nozzleMm: "", buildXMm: "", buildYMm: "", buildZMm: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="pf-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-printer",
          name: form.name,
          model: form.model || undefined,
          nozzleMm: form.nozzleMm ? Number(form.nozzleMm) : undefined,
          buildXMm: form.buildXMm ? Number(form.buildXMm) : undefined,
          buildYMm: form.buildYMm ? Number(form.buildYMm) : undefined,
          buildZMm: form.buildZMm ? Number(form.buildZMm) : undefined,
        });
        setForm(empty);
      }}
    >
      <label>
        Printer name
        <input value={form.name} onChange={set("name")} placeholder="Prusa MK4 #1" required />
      </label>
      <label>
        Model (optional)
        <input value={form.model} onChange={set("model")} placeholder="Prusa MK4" />
      </label>
      <label>
        Nozzle mm (optional)
        <input type="number" step="0.05" min={0.1} value={form.nozzleMm} onChange={set("nozzleMm")} />
      </label>
      <label>
        Build X mm
        <input type="number" min={1} value={form.buildXMm} onChange={set("buildXMm")} />
      </label>
      <label>
        Build Y mm
        <input type="number" min={1} value={form.buildYMm} onChange={set("buildYMm")} />
      </label>
      <label>
        Build Z mm
        <input type="number" min={1} value={form.buildZMm} onChange={set("buildZMm")} />
      </label>
      <Button type="submit" size="sm" disabled={busy || !form.name.trim()}>
        Add printer
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- filament

function spoolLabel(filament: FilamentView | { material: FilamentMaterial; brand: string | null; color: string | null }): string {
  return [materialLabel(filament.material), filament.brand ?? undefined, filament.color ?? undefined]
    .filter(Boolean)
    .join(" ");
}

function FilamentPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  return (
    <Panel id="print-farm-filament" className="pf-panel">
      <h2>Filament</h2>
      {view.filaments.length === 0 ? (
        <EmptyState
          soft
          badge="No spools yet"
          badgeTone="setup"
          title="Add your first spool"
          description="Track grams by hand — every finish/fail entry decrements the spool it used."
        />
      ) : (
        <ul className="pf-list">
          {view.filaments.map((filament) => (
            <FilamentRow key={filament.id} filament={filament} busy={busy} mutate={mutate} />
          ))}
        </ul>
      )}
      <AddSpoolForm busy={busy} mutate={mutate} />
    </Panel>
  );
}

function FilamentRow({ filament, busy, mutate }: { filament: FilamentView; busy: boolean; mutate: Mutate }) {
  const [adjustGrams, setAdjustGrams] = useState("");
  const [adjustReason, setAdjustReason] = useState<"restock" | "audit" | "waste" | "purge">("audit");
  return (
    <li className="pf-row">
      <div className="pf-row-main">
        <div>
          {filament.spool.low ? <Badge tone="danger">Low</Badge> : null}{" "}
          <strong className="pf-name">{spoolLabel(filament)}</strong>
        </div>
        <small className="app-muted pf-block">
          {[
            filament.diameterMm != null ? `${filament.diameterMm}mm` : undefined,
            filament.vendor ?? undefined,
            filament.unitCostUsd != null ? `$${filament.unitCostUsd.toFixed(2)}/spool` : undefined,
            filament.openedOn ? `opened ${filament.openedOn}` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <div className="pf-meter">
          {filament.spoolGramsTotal != null ? (
            <ProgressMeter
              label="Remaining"
              value={Math.round(filament.gramsRemaining)}
              target={Math.round(filament.spoolGramsTotal)}
              unit="g"
            />
          ) : (
            <small className="app-muted">{Math.round(filament.gramsRemaining)} g remaining (spool total unknown)</small>
          )}
        </div>
        <small className="app-muted pf-block">
          {filament.runwayDays.value != null
            ? `~${filament.runwayDays.value.toFixed(1)} days left at the observed burn rate (${filament.runwayDays.sampleSize} usage entries)`
            : `Runway not computed — ${filament.runwayDays.reason}`}
        </small>
      </div>
      <form
        className="pf-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const grams = Number(adjustGrams);
          if (!Number.isFinite(grams) || grams === 0) return;
          mutate({ action: "adjust-spool", filamentId: filament.id, grams, reason: adjustReason });
          setAdjustGrams("");
        }}
      >
        <label>
          Adjust grams (+/−)
          <input
            type="number"
            step="1"
            value={adjustGrams}
            onChange={(e) => setAdjustGrams(e.target.value)}
            aria-label={`Adjust grams for ${spoolLabel(filament)}`}
          />
        </label>
        <label>
          Reason
          <select
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value as typeof adjustReason)}
            aria-label={`Adjustment reason for ${spoolLabel(filament)}`}
          >
            <option value="audit">Audit (weighed it)</option>
            <option value="restock">Restock</option>
            <option value="waste">Waste</option>
            <option value="purge">Purge</option>
          </select>
        </label>
        <Button type="submit" size="sm" disabled={busy || !adjustGrams}>
          Log
        </Button>
      </form>
    </li>
  );
}

function AddSpoolForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      material: "pla" as FilamentMaterial,
      brand: "",
      color: "",
      spoolGramsTotal: "",
      gramsRemaining: "",
      vendor: "",
      unitCostUsd: "",
      openedOn: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="pf-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({
          action: "add-spool",
          material: form.material,
          brand: form.brand || undefined,
          color: form.color || undefined,
          spoolGramsTotal: form.spoolGramsTotal ? Number(form.spoolGramsTotal) : undefined,
          gramsRemaining: form.gramsRemaining ? Number(form.gramsRemaining) : undefined,
          vendor: form.vendor || undefined,
          unitCostUsd: form.unitCostUsd ? Number(form.unitCostUsd) : undefined,
          openedOn: form.openedOn || undefined,
        });
        setForm(empty);
      }}
    >
      <label>
        Material
        <select value={form.material} onChange={set("material")}>
          {FILAMENT_MATERIALS.map((material) => (
            <option key={material} value={material}>
              {materialLabel(material)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Brand (optional)
        <input value={form.brand} onChange={set("brand")} placeholder="Polymaker" />
      </label>
      <label>
        Color (optional)
        <input value={form.color} onChange={set("color")} placeholder="Black" />
      </label>
      <label>
        Spool grams
        <input type="number" min={1} value={form.spoolGramsTotal} onChange={set("spoolGramsTotal")} placeholder="1000" />
      </label>
      <label>
        Grams remaining (if partly used)
        <input type="number" min={0} value={form.gramsRemaining} onChange={set("gramsRemaining")} />
      </label>
      <label>
        Opened on (optional)
        <input type="date" value={form.openedOn} onChange={set("openedOn")} />
      </label>
      <Button type="submit" size="sm" disabled={busy}>
        Add spool
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- recent finished

function RecentFinishedPanel({ view }: { view: LiveView }) {
  if (view.recentFinished.length === 0) return null;
  return (
    <Panel className="pf-panel">
      <h2>Recently finished</h2>
      <ul className="pf-list">
        {view.recentFinished.map((job) => (
          <li key={job.id} className="pf-row">
            <div className="pf-row-main">
              <div>
                <Badge tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
              </div>
              <strong className="pf-name">{job.partName}</strong>
              <small className="app-muted pf-block">
                {[
                  `×${job.quantity}`,
                  job.subsystemName ?? undefined,
                  job.finishedAt ? new Date(job.finishedAt).toLocaleString() : undefined,
                  job.actualMinutes != null ? `${job.actualMinutes} min` : undefined,
                  job.actualGrams != null ? `${job.actualGrams} g` : undefined,
                  job.failureReason ? failureReasonLabel(job.failureReason) : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
