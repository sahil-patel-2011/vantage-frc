"use client";

import { Button, EmptyState } from "../../components/ui";
import {
  batteryBreakInCue,
  batteryOverDischargeCue,
  batteryVentChargeCue,
} from "../../lib/battery";
import { formatPackEvidence } from "../../lib/battery/battery-related";
import {
  fmtWhen,
  healthBadge,
  logKindLabel,
  type Pack,
  type ReadyView,
  type RunFn,
} from "./batteries-model";
import { AssignRow } from "./batteries-assign";

export function BatteriesFleetColumn({
  view,
  orgId,
  busy,
  canDelete,
  measuredCount,
  rotationPacks,
  run,
  onLogIr,
}: {
  view: ReadyView;
  orgId: string;
  busy: boolean;
  canDelete: boolean;
  measuredCount: number;
  rotationPacks: Pack[];
  run: RunFn;
  onLogIr: (packId: string) => void;
}) {
  return (
    <>
      {view.packs.length === 0 ? (
        <EmptyState
          title="No batteries yet"
          description="Add a pack label to start. Resistance, voltage, and cycles stay blank until someone logs them."
          soft
        >
          <Button as="a" variant="primary" href="#batt-add-pack">
            Add a battery
          </Button>
        </EmptyState>
      ) : null}
      <div className="batt-panel">
          {view.packs.some((pack) => pack.cartSlot.kind !== "parked") ? (
            <section className="app-card soft-panel">
              <h2>Competition cart</h2>
              <p className="app-muted">
                Killer Bees cool-down: 15 minutes off the charger before a Beak test, then Ready. Slots stay empty until
                you log a real charge.
              </p>
              <ul className="batt-cart">
                {view.packs
                  .filter((pack) => pack.cartSlot.kind !== "parked")
                  .map((pack) => (
                    <li key={pack.id} className={`batt-cart-row ${pack.cartSlot.kind}`}>
                      <div>
                        <strong>{pack.label}</strong>
                        <small className="app-muted">{pack.cartSlot.detail}</small>
                      </div>
                      <span className={`batt-badge ${pack.cartSlot.kind === "ready" ? "ready" : pack.cartSlot.kind === "cooling" ? "aging" : "unmeasured"}`}>
                        {pack.cartSlot.label}
                        {pack.cartSlot.minutesRemaining ? ` · ${pack.cartSlot.minutesRemaining}m` : ""}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
          {view.packs.length > 0 && rotationPacks.length === 0 ? (
            <EmptyState
              soft
              title="No rotation candidates"
              description="Active packs need a real IR or voltage log before they can rank for match rotation. Log a Battery Beak test below."
            />
          ) : null}

          {rotationPacks.length > 0 ? (
            <section className="app-card soft-panel">
              <h2>Recommended rotation</h2>
              <p className="app-muted">
                Healthiest packs with logged evidence, least-recently-used first — grab these for the next matches.
              </p>
              <ol className="batt-rotation">
                {rotationPacks.map((pack, index) => (
                  <li key={pack.id} className={index === 0 ? "next" : undefined}>
                    <span className="rank">{index + 1}</span>
                    <span className="meta">
                      <strong>{pack.label}</strong>
                      <small>
                        {pack.cycleCount > 0 ? `${pack.cycleCount} cycles logged` : "No cycles logged"}
                        {pack.assignment ? ` · ${pack.assignment}` : ""}
                        {pack.lastUsedAt ? ` · last used ${fmtWhen(pack.lastUsedAt)}` : " · never used in a match/practice log"}
                        {pack.lastInternalResistanceMohm != null
                          ? ` · ${pack.lastInternalResistanceMohm} mΩ`
                          : " · no IR yet"}
                      </small>
                    </span>
                    {pack.health.score != null ? (
                      <span className="score">{pack.health.score}</span>
                    ) : (
                      <span className="score muted" title="No resistance or voltage measurement logged yet">
                        —
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {view.packs.length > 0 ? (
            <section className="app-card soft-panel">
              <header className="batt-section-head">
                <h2>Fleet</h2>
                <p className="app-muted">
                  {measuredCount}/{view.packs.length} packs have IR or voltage logs.
                </p>
              </header>
              <ul className="batt-fleet">
                {view.packs.map((pack) => {
                  const badge = healthBadge(pack.health);
                  // One predicate for the row, the badge and the nudge below,
                  // and it is the same one the scoring uses.
                  const measured = badge.tone !== "unmeasured";
                  const breakInCue = batteryBreakInCue(pack.cycleCount);
                  const overDischargeCue = batteryOverDischargeCue({
                    cycleCount: pack.cycleCount,
                    lastRestingVoltage: pack.lastRestingVoltage,
                  });
                  const ventChargeCue = batteryVentChargeCue({
                    lastChargedAt: pack.lastChargedAt,
                    lastUsedAt: pack.lastUsedAt,
                  });
                  return (
                    <li
                      key={pack.id}
                      className={
                        !measured ? "unmeasured" : pack.health.status === "good" ? undefined : pack.health.status
                      }
                    >
                      <div className="batt-fleet-top">
                        <div className="who">
                          <strong>
                            {pack.label}
                            {pack.brand ? ` · ${pack.brand}` : ""}
                          </strong>
                          <small>
                            {formatPackEvidence({
                              cycleCount: pack.cycleCount,
                              nominalAh: pack.nominalAh,
                              lastInternalResistanceMohm: pack.lastInternalResistanceMohm,
                              lastRestingVoltage: pack.lastRestingVoltage,
                              ageMonths: pack.ageMonths,
                              lastChargedAt: pack.lastChargedAt,
                              formatWhen: fmtWhen,
                            })}
                          </small>
                        </div>
                        <div className="batt-badges">
                          {/* One badge, whatever the state: Unknown when nothing
                              has been measured, the grade when something has. */}
                          <span className={`batt-badge ${badge.tone}`}>{badge.label}</span>
                          <span className={`batt-badge ${pack.readiness.ready ? "ready" : "block"}`}>
                            {pack.readiness.ready ? "Event ready" : "Not ready"}
                          </span>
                          {pack.cartSlot.kind !== "parked" ? (
                            <span
                              className={`batt-badge ${pack.cartSlot.kind === "ready" ? "ready" : pack.cartSlot.kind === "cooling" ? "aging" : "unmeasured"}`}
                            >
                              {pack.cartSlot.label}
                            </span>
                          ) : null}
                          {pack.status !== "active" ? <span className="batt-badge">{pack.status}</span> : null}
                          {pack.assignment ? <span className="batt-badge">{pack.assignment}</span> : null}
                          {breakInCue ? (
                            <span className="batt-badge aging">Break in</span>
                          ) : null}
                          {overDischargeCue ? (
                            <span className="batt-badge aging">Over-discharge</span>
                          ) : null}
                          {ventChargeCue ? (
                            <span className="batt-badge aging">Charge vents</span>
                          ) : null}
                        </div>
                      </div>
                      {!measured ? (
                        <small className="app-muted">
                          Log a resistance test or voltage. Health stays blank until someone measures it.
                        </small>
                      ) : pack.health.reasons.length > 0 || pack.readiness.reasons.length > 0 ? (
                        <small className="app-muted">
                          {[
                            ...pack.health.reasons,
                            ...pack.readiness.reasons.filter((r) => !pack.health.reasons.includes(r)),
                          ].join("; ")}
                        </small>
                      ) : null}
                      {breakInCue ? <small className="app-muted">{breakInCue}</small> : null}
                      {overDischargeCue ? <small className="app-muted">{overDischargeCue}</small> : null}
                      {ventChargeCue ? <small className="app-muted">{ventChargeCue}</small> : null}
                      <AssignRow pack={pack} orgId={orgId} busy={busy} run={run} />
                      <div className="batt-actions">
                        {pack.status === "active" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                { action: "log_event", orgId, batteryId: pack.id, kind: "charge" },
                                `charge:${pack.id}`,
                              )
                            }
                          >
                            Mark charged
                          </button>
                        ) : null}
                        {pack.status === "active" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onLogIr(pack.id)}
                          >
                            Log IR test
                          </button>
                        ) : null}
                        {pack.status === "active" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                {
                                  action: "set_status",
                                  orgId,
                                  id: pack.id,
                                  status: "quarantine",
                                  note: "Quarantined from UI",
                                },
                                `q:${pack.id}`,
                              )
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
                                void run(
                                  {
                                    action: "set_status",
                                    orgId,
                                    id: pack.id,
                                    status: "retired",
                                    note: "Retired from UI",
                                  },
                                  `retire:${pack.id}`,
                                );
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
                              void run(
                                {
                                  action: "set_status",
                                  orgId,
                                  id: pack.id,
                                  status: "active",
                                  note: "Returned to service",
                                },
                                `act:${pack.id}`,
                              )
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
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="app-card soft-panel">
            <h2>Recent activity</h2>
            {view.logs.length === 0 ? (
              <EmptyState
                soft
                title="No activity logged yet"
                description="Charge, match, practice, and resistance tests show up here. The feed stays empty until someone logs a real event."
              >
                {view.packs.length > 0 ? (
                  <Button variant="secondary" type="button" onClick={() => document.getElementById("batt-log-form")?.scrollIntoView({ behavior: "smooth", block: "start" }) }>
                    Log an event
                  </Button>
                ) : null}
              </EmptyState>
            ) : (
              <ul className="batt-log">
                {view.logs.slice(0, 30).map((log) => (
                  <li key={log.id}>
                    <strong>
                      {log.batteryLabel} · {logKindLabel(log.kind)}
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
    </>
  );
}
