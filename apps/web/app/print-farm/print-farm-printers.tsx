"use client";

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Panel } from "../../components/ui";
import { PRINTER_STATUSES, reportedAgoLabel } from "../../lib/print-farm";
import type { PrinterView } from "../../lib/print-farm/compute-print-farm";
import { PRINTER_STATUS_LABEL, spoolLabel, type LiveView, type Mutate } from "./print-farm-model";

export function PrintersPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
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
