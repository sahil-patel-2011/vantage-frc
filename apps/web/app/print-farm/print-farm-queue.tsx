"use client";

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, FormGrid, FormRow, Panel } from "../../components/ui";
import {
  FAILURE_REASONS,
  JOB_PRIORITIES,
  JOB_PURPOSES,
  failureReasonLabel,
  purposeLabel,
} from "../../lib/print-farm";
import type { JobView } from "../../lib/print-farm/compute-print-farm";
import type { FailureReason, JobPriority, JobPurpose } from "../../lib/print-farm/types";
import {
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  PRIORITY_LABEL,
  jobSubtitle,
  spoolLabel,
  type LiveView,
  type Mutate,
} from "./print-farm-model";

export function QueueJobForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
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

export function QueuePanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
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
