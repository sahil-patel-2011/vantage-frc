"use client";

import { Button, EmptyState } from "../../components/ui";
import { BATTERY_LOG_KINDS } from "../../lib/battery";
import {
  EMPTY_PACK_FORM,
  logKindLabel,
  type LogForm,
  type PackForm,
  type ReadyView,
  type RunFn,
} from "./batteries-model";

export function BatteriesForms({
  view,
  orgId,
  busy,
  packForm,
  setPackForm,
  logForm,
  setLogForm,
  run,
}: {
  view: ReadyView;
  orgId: string;
  busy: boolean;
  packForm: PackForm;
  setPackForm: (next: PackForm) => void;
  logForm: LogForm;
  setLogForm: (next: LogForm | ((prev: LogForm) => LogForm)) => void;
  run: RunFn;
}) {
  return (
        <aside className="batt-panel batt-forms">
          <form
            id="batt-add-pack"
            className="batt-form app-card soft-panel"
            onSubmit={(event) => {
              event.preventDefault();
              if (!packForm.label.trim()) return;
              void run(
                {
                  action: "create_pack",
                  orgId,
                  label: packForm.label.trim(),
                  brand: packForm.brand,
                  nominalAh: packForm.nominalAh,
                  purchaseDate: packForm.purchaseDate,
                  assignment: packForm.assignment,
                  initialResistanceMohm: packForm.initialResistanceMohm,
                  initialVoltage: packForm.initialVoltage,
                },
                "create",
              ).then(() =>
                setPackForm(EMPTY_PACK_FORM),
              );
            }}
          >
            <h3>Add a battery</h3>
            <p className="app-muted batt-form-hint">
              Optional initial IR/voltage become the first log entries. Leave them blank if you have not measured yet.
            </p>
            <div className="batt-form-grid">
              <label className="batt-field">
                <span>Label</span>
                <input
                  required
                  value={packForm.label}
                  disabled={busy}
                  placeholder="B-01"
                  onChange={(e) => setPackForm({ ...packForm, label: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Brand</span>
                <input
                  value={packForm.brand}
                  disabled={busy}
                  placeholder="MK ES17-12"
                  onChange={(e) => setPackForm({ ...packForm, brand: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Capacity (Ah)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={packForm.nominalAh}
                  disabled={busy}
                  onChange={(e) => setPackForm({ ...packForm, nominalAh: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Purchase date</span>
                <input
                  type="date"
                  value={packForm.purchaseDate}
                  disabled={busy}
                  onChange={(e) => setPackForm({ ...packForm, purchaseDate: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Assignment</span>
                <input
                  value={packForm.assignment}
                  disabled={busy}
                  placeholder="Spare cart"
                  onChange={(e) => setPackForm({ ...packForm, assignment: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Initial resistance (mΩ)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={packForm.initialResistanceMohm}
                  disabled={busy}
                  placeholder="Optional"
                  onChange={(e) => setPackForm({ ...packForm, initialResistanceMohm: e.target.value })}
                />
              </label>
              <label className="batt-field">
                <span>Initial voltage (V)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={packForm.initialVoltage}
                  disabled={busy}
                  placeholder="Optional"
                  onChange={(e) => setPackForm({ ...packForm, initialVoltage: e.target.value })}
                />
              </label>
            </div>
            <Button variant="primary" type="submit" disabled={busy || !packForm.label.trim()}>
              Add battery
            </Button>
          </form>

          <form
            id="batt-log-form"
            className="batt-form app-card soft-panel"
            onSubmit={(event) => {
              event.preventDefault();
              if (!logForm.batteryId) return;
              void run(
                {
                  action: "log_event",
                  orgId,
                  batteryId: logForm.batteryId,
                  kind: logForm.kind,
                  restingVoltage: logForm.restingVoltage,
                  internalResistanceMohm: logForm.internalResistanceMohm,
                  matchKey: logForm.matchKey,
                  note: logForm.note,
                },
                "log",
              ).then(() =>
                setLogForm((prev) => ({
                  ...prev,
                  restingVoltage: "",
                  internalResistanceMohm: "",
                  matchKey: "",
                  note: "",
                })),
              );
            }}
          >
            <h3>Log an event</h3>
            {view.packs.length === 0 ? (
              <EmptyState soft title="Add a pack first" description="Events attach to a labeled pack on this team." />
            ) : (
              <>
                <p className="app-muted batt-form-hint">
                  Match/practice logs increment cycle count. Resistance tests store IR for health — leave blanks when you
                  did not measure.
                </p>
                <div className="batt-form-grid">
                  <label className="batt-field">
                    <span>Battery</span>
                    <select
                      value={logForm.batteryId}
                      disabled={busy}
                      onChange={(e) => setLogForm({ ...logForm, batteryId: e.target.value })}
                    >
                      {view.packs.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="batt-field">
                    <span>Event</span>
                    <select
                      value={logForm.kind}
                      disabled={busy}
                      onChange={(e) => setLogForm({ ...logForm, kind: e.target.value })}
                    >
                      {BATTERY_LOG_KINDS.filter((kind) => !["retire", "return_to_service"].includes(kind)).map((kind) => (
                        <option key={kind} value={kind}>
                          {logKindLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="batt-field">
                    <span>Voltage (V)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={logForm.restingVoltage}
                      disabled={busy}
                      placeholder="Optional"
                      onChange={(e) => setLogForm({ ...logForm, restingVoltage: e.target.value })}
                    />
                  </label>
                  <label className="batt-field">
                    <span>Resistance (mΩ)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={logForm.internalResistanceMohm}
                      disabled={busy}
                      placeholder="Optional"
                      onChange={(e) => setLogForm({ ...logForm, internalResistanceMohm: e.target.value })}
                    />
                  </label>
                  {(logForm.kind === "match" || logForm.kind === "practice") && (
                    <label className="batt-field">
                      <span>Match key</span>
                      <input
                        value={logForm.matchKey}
                        disabled={busy}
                        placeholder="2026wimi_qm5"
                        onChange={(e) => setLogForm({ ...logForm, matchKey: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="batt-field">
                    <span>Note</span>
                    <input
                      value={logForm.note}
                      disabled={busy}
                      onChange={(e) => setLogForm({ ...logForm, note: e.target.value })}
                    />
                  </label>
                </div>
                <Button variant="secondary" type="submit" disabled={busy || !logForm.batteryId}>
                  Log event
                </Button>
              </>
            )}
          </form>
        </aside>
  );
}

