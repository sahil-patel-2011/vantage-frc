"use client";

import { useCallback, useEffect, useState } from "react";
import { BATTERY_LOG_KINDS, type BatteryStatus, type HealthStatus } from "../../lib/battery";

type Pack = {
  id: string;
  label: string;
  brand: string | null;
  nominalAh: number | null;
  purchaseDate: string | null;
  status: BatteryStatus;
  assignment: string;
  notes: string;
  cycleCount: number;
  ageMonths: number | null;
  lastInternalResistanceMohm: number | null;
  lastRestingVoltage: number | null;
  lastUsedAt: string | null;
  lastChargedAt: string | null;
  health: { status: HealthStatus; score: number; reasons: string[] };
  readiness: { ready: boolean; reasons: string[] };
};

type Log = {
  id: string;
  batteryId: string;
  batteryLabel: string;
  kind: string;
  restingVoltage: number | null;
  internalResistanceMohm: number | null;
  matchKey: string | null;
  note: string;
  byName: string | null;
  createdAt: string;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; orgName?: string | null; teamNumber?: number | null; role: string };
      packs: Pack[];
      logs: Log[];
      rotation: string[];
      summary: { active: number; competitionReady: number; needAttention: number; retired: number };
    };

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

const HEALTH_LABEL: Record<HealthStatus, string> = { good: "Good", aging: "Aging", retire: "Retire" };
const LOG_KIND_LABEL: Record<string, string> = {
  charge: "Charged",
  storage_charge: "Storage charge",
  match: "Match",
  practice: "Practice",
  resistance_test: "Resistance test",
  note: "Note",
  retire: "Retired",
  return_to_service: "Back in service",
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function AssignRow({
  pack,
  orgId,
  busy,
  run,
}: {
  pack: Pack;
  orgId: string;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [value, setValue] = useState(pack.assignment);
  useEffect(() => {
    setValue(pack.assignment);
  }, [pack.assignment]);

  return (
    <form
      className="batt-assign"
      onSubmit={(event) => {
        event.preventDefault();
        void run({ action: "assign_pack", orgId, id: pack.id, assignment: value.trim() }, `assign:${pack.id}`);
      }}
    >
      <label>
        Assignment
        <input
          value={value}
          disabled={busy}
          placeholder="Robot · Charger A · Spare cart"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button type="submit" className="app-button secondary" disabled={busy}>
        Save
      </button>
    </form>
  );
}

export default function BatteriesClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [packForm, setPackForm] = useState({
    label: "",
    brand: "",
    nominalAh: "18",
    purchaseDate: "",
    assignment: "",
    initialResistanceMohm: "",
    initialVoltage: "",
  });
  const [logForm, setLogForm] = useState({
    batteryId: "",
    kind: "resistance_test",
    restingVoltage: "",
    internalResistanceMohm: "",
    matchKey: "",
    note: "",
  });

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/batteries${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !("status" in data)) {
        setError(data.error ?? "Could not load batteries.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      if (data.status === "ready") {
        setLogForm((prev) => {
          if (prev.batteryId && data.packs.some((pack) => pack.id === prev.batteryId)) return prev;
          return { ...prev, batteryId: data.packs[0]?.id ?? "" };
        });
      }
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      setOkMessage("");
      try {
        const response = await fetch("/api/batteries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        setOkMessage(
          body.action === "create_pack"
            ? "Battery added."
            : body.action === "log_event"
              ? "Logged."
              : body.action === "assign_pack"
                ? "Assignment updated."
                : "Updated.",
        );
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page batt-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Pit / Batteries</span>
            <h1>Battery Fleet</h1>
          </div>
        </header>
        <div className="app-card batt-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load batteries</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading batteries…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page batt-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Pit / Batteries</span>
            <h1>Battery Fleet</h1>
            <p>Track charge cycles, assignment, and competition readiness for every pack.</p>
          </div>
        </header>
        <div className="app-card batt-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId;
  const busy = busyKey != null;
  const rotationPacks = view.rotation
    .map((id) => view.packs.find((pack) => pack.id === id))
    .filter((pack): pack is Pack => Boolean(pack));
  const canDelete = view.context.role === "owner" || view.context.role === "admin";

  return (
    <main className="module-page batt-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Pit / Batteries</span>
          <h1>Battery Fleet</h1>
          <p>
            Charge cycles, assignment, and event readiness for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""}.
          </p>
        </div>
        <div className="batt-header-actions">
          <a className="app-button secondary" href={orgId ? `/pit?orgId=${encodeURIComponent(orgId)}` : "/pit"}>
            Pit Command
          </a>
          <a className="app-button secondary" href={orgId ? `/inventory?orgId=${encodeURIComponent(orgId)}` : "/inventory"}>
            Inventory
          </a>
        </div>
      </header>

      {error ? (
        <p className="batt-alert" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="batt-alert ok" role="status">
          {okMessage}
        </p>
      ) : null}

      <section className="batt-summary" aria-label="Fleet summary">
        <article className="batt-summary-tile">
          <strong>{view.summary.active}</strong>
          <span>Active packs</span>
        </article>
        <article className="batt-summary-tile ready">
          <strong>{view.summary.competitionReady}</strong>
          <span>Competition ready</span>
        </article>
        <article className={`batt-summary-tile${view.summary.needAttention ? " warn" : ""}`}>
          <strong>{view.summary.needAttention}</strong>
          <span>Need attention</span>
        </article>
        <article className="batt-summary-tile">
          <strong>{rotationPacks[0]?.label ?? "—"}</strong>
          <span>Next up</span>
        </article>
      </section>

      {view.packs.length === 0 ? (
        <div className="app-card batt-empty">
          <strong>No batteries yet</strong>
          <p className="app-muted">Add your first pack to start tracking cycles, resistance, and match rotation.</p>
        </div>
      ) : null}

      <div className="batt-layout">
        <div className="batt-panel">
          {rotationPacks.length > 0 ? (
            <section className="app-card">
              <h2>Recommended rotation</h2>
              <p className="app-muted">Healthiest packs, least-recently-used first — grab these for the next matches.</p>
              <ol className="batt-rotation">
                {rotationPacks.map((pack, index) => (
                  <li key={pack.id} className={index === 0 ? "next" : undefined}>
                    <span className="rank">{index + 1}</span>
                    <span className="meta">
                      <strong>{pack.label}</strong>
                      <small>
                        {pack.cycleCount} cycles
                        {pack.assignment ? ` · ${pack.assignment}` : ""}
                        {pack.lastUsedAt ? ` · last used ${fmtWhen(pack.lastUsedAt)}` : " · never used"}
                      </small>
                    </span>
                    <span className="score">{pack.health.score}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="app-card">
            <h2>Fleet</h2>
            <ul className="batt-fleet">
              {view.packs.map((pack) => (
                <li key={pack.id} className={pack.health.status === "good" ? undefined : pack.health.status}>
                  <div className="batt-fleet-top">
                    <div className="who">
                      <strong>
                        {pack.label}
                        {pack.brand ? ` · ${pack.brand}` : ""}
                      </strong>
                      <small>
                        {pack.cycleCount} cycles
                        {pack.nominalAh != null ? ` · ${pack.nominalAh} Ah` : ""}
                        {pack.lastInternalResistanceMohm != null ? ` · ${pack.lastInternalResistanceMohm} mΩ` : ""}
                        {pack.lastRestingVoltage != null ? ` · ${pack.lastRestingVoltage} V` : ""}
                        {pack.ageMonths != null ? ` · ${pack.ageMonths} mo` : ""}
                        {" · charged "}
                        {fmtWhen(pack.lastChargedAt)}
                      </small>
                    </div>
                    <div className="batt-badges">
                      <span className={`batt-badge ${pack.health.status}`}>{HEALTH_LABEL[pack.health.status]}</span>
                      <span className={`batt-badge ${pack.readiness.ready ? "ready" : "block"}`}>
                        {pack.readiness.ready ? "Event ready" : "Not ready"}
                      </span>
                      {pack.status !== "active" ? <span className="batt-badge">{pack.status}</span> : null}
                      {pack.assignment ? <span className="batt-badge">{pack.assignment}</span> : null}
                    </div>
                  </div>
                  {(pack.health.reasons.length > 0 || pack.readiness.reasons.length > 0) && (
                    <small className="app-muted">
                      {[...pack.health.reasons, ...pack.readiness.reasons.filter((r) => !pack.health.reasons.includes(r))].join("; ")}
                    </small>
                  )}
                  <AssignRow pack={pack} orgId={orgId} busy={busy} run={run} />
                  <div className="batt-actions">
                    {pack.status === "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run({ action: "log_event", orgId, batteryId: pack.id, kind: "charge" }, `charge:${pack.id}`)
                        }
                      >
                        Mark charged
                      </button>
                    ) : null}
                    {pack.status === "active" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run({ action: "set_status", orgId, id: pack.id, status: "quarantine", note: "Quarantined from UI" }, `q:${pack.id}`)
                        }
                      >
                        Quarantine
                      </button>
                    ) : null}
                    {pack.status === "active" ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Retire ${pack.label}?`)) {
                            void run({ action: "set_status", orgId, id: pack.id, status: "retired", note: "Retired from UI" }, `retire:${pack.id}`);
                          }
                        }}
                      >
                        Retire
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run({ action: "set_status", orgId, id: pack.id, status: "active", note: "Returned to service" }, `act:${pack.id}`)
                        }
                      >
                        Activate
                      </button>
                    )}
                    {canDelete ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Delete ${pack.label}? This removes its log.`)) {
                            void run({ action: "delete_pack", orgId, id: pack.id }, `del:${pack.id}`);
                          }
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="app-card">
            <h2>Recent activity</h2>
            {view.logs.length === 0 ? (
              <p className="app-muted">No activity logged yet.</p>
            ) : (
              <ul className="batt-log">
                {view.logs.slice(0, 30).map((log) => (
                  <li key={log.id}>
                    <strong>
                      {log.batteryLabel} · {LOG_KIND_LABEL[log.kind] ?? log.kind}
                    </strong>
                    <small>
                      {fmtWhen(log.createdAt)}
                      {log.byName ? ` · ${log.byName}` : ""}
                      {log.internalResistanceMohm != null ? ` · ${log.internalResistanceMohm} mΩ` : ""}
                      {log.restingVoltage != null ? ` · ${log.restingVoltage} V` : ""}
                      {log.matchKey ? ` · ${log.matchKey}` : ""}
                      {log.note ? ` · ${log.note}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="batt-panel batt-forms">
          <form
            className="batt-form app-card"
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
                setPackForm({
                  label: "",
                  brand: "",
                  nominalAh: "18",
                  purchaseDate: "",
                  assignment: "",
                  initialResistanceMohm: "",
                  initialVoltage: "",
                }),
              );
            }}
          >
            <h3>Add a battery</h3>
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
                  onChange={(e) => setPackForm({ ...packForm, initialVoltage: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" className="app-button" disabled={busy || !packForm.label.trim()}>
              Add battery
            </button>
          </form>

          <form
            className="batt-form app-card"
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
              <p className="app-muted">Add a pack before logging events.</p>
            ) : (
              <>
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
                    <select value={logForm.kind} disabled={busy} onChange={(e) => setLogForm({ ...logForm, kind: e.target.value })}>
                      {BATTERY_LOG_KINDS.filter((kind) => !["retire", "return_to_service"].includes(kind)).map((kind) => (
                        <option key={kind} value={kind}>
                          {LOG_KIND_LABEL[kind]}
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
                    <input value={logForm.note} disabled={busy} onChange={(e) => setLogForm({ ...logForm, note: e.target.value })} />
                  </label>
                </div>
                <button type="submit" className="app-button secondary" disabled={busy || !logForm.batteryId}>
                  Log event
                </button>
              </>
            )}
          </form>
        </aside>
      </div>
    </main>
  );
}
