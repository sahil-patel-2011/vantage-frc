"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { BuildHubRelated } from "../../components/build-hub-related";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { BATTERY_LOG_KINDS, batteryBreakInCue, batteryOverDischargeCue, batteryVentChargeCue, type BatteryStatus, type CartSlot, type HealthStatus } from "../../lib/battery";
import {
  BATTERIES_BUILD_RELATED_INCLUDE,
  BATTERIES_TEAM_RELATED_INCLUDE,
  batteryNextActions,
  formatPackEvidence,
  packHasMeasurement,
} from "../../lib/battery/battery-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./batteries.css";

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
  /**
   * `score` is null for a pack nobody has measured — the API returns whatever
   * `batteryHealth` produced, and that function stopped inventing 100 for an
   * untested pack. This type used to say `score: number`, which let the client
   * treat "unknown" as if it were a number and let `status` (which stays
   * "good" for an unmeasured pack, because no measurement escalated it) speak
   * for a health nobody has checked. Both are now read through
   * `healthBadge()` below.
   */
  health: { status: HealthStatus; score: number | null; reasons: string[] };
  readiness: { ready: boolean; reasons: string[] };
  cartSlot: CartSlot;
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
      summary: { active: number; competitionReady: number; needAttention: number; retired: number; cartReady: number; cartCooling: number };
    };

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

const HEALTH_LABEL: Record<HealthStatus, string> = { good: "Good", aging: "Aging", retire: "Retire" };

/**
 * The health badge for one pack.
 *
 * `status` alone is not safe to render: `batteryHealth` only ever *escalates*
 * away from "good", so a pack with no internal-resistance or resting-voltage
 * log comes back "good" simply because nothing contradicted it. On competition
 * day that badge said "Good" about a pack the team had never tested. `score`
 * is the honest signal — it is null exactly when there is no measurement — so
 * the badge reads off the score and says Unknown rather than picking a grade
 * out of nothing.
 */
function healthBadge(health: Pack["health"]): { tone: "unmeasured" | HealthStatus; label: string } {
  if (health.score == null) return { tone: "unmeasured", label: "Unknown" };
  return { tone: health.status, label: HEALTH_LABEL[health.status] };
}
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

function useHubEmbed(): "team" | "build" | null {
  const [embed, setEmbed] = useState<"team" | "build" | null>(null);
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith("/team")) setEmbed("team");
    else if (path.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
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

function BatteriesRelated({ orgId }: { orgId: string }) {
  return (
    <div className="batt-related">
      <TeamHubRelated orgId={orgId} active="batteries" include={[...BATTERIES_TEAM_RELATED_INCLUDE]} />
      <BuildHubRelated orgId={orgId} active="batteries" include={[...BATTERIES_BUILD_RELATED_INCLUDE]} />
    </div>
  );
}

export default function BatteriesClient({ embedded = false }: { embedded?: boolean } = {}) {
  const pathEmbed = useHubEmbed();
  const embed = pathEmbed ?? (embedded ? "team" : null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [okMessage, setOkMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
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
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
      if (data.status === "ready") {
        setLogForm((prev) => {
          if (prev.batteryId && data.packs.some((pack) => pack.id === prev.batteryId)) return prev;
          return { ...prev, batteryId: data.packs[0]?.id ?? "" };
        });
      }
    } catch {
      setErrorStatus(null);
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

  const crumbs = embed === "build" ? "Build / Batteries" : "Team / Batteries";

  if (fetchFailed || !view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || "Check your connection and try again.",
          },
        )
      : null;
    return (
      <main className="module-page batt-page">
        <PageHeader breadcrumbs={crumbs} title="Batteries" />
        {!embed ? <TeamOpsNav active="batteries" /> : null}
        <EmptyState
          title={failure ? failure.title : "Loading batteries…"}
          description={failure ? failure.description : undefined}
          soft
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure?.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupActions = batteryNextActions({ packs: [], logCount: 0 });
    return (
      <main className="module-page batt-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Batteries"
          description="Track charge cycles, assignment, and competition readiness for every pack — from real logs only."
        />
        {!embed ? <TeamOpsNav active="batteries" /> : null}
        <EmptyState title="Select a team workspace" description={view.message} badge="Setup" badgeTone="setup" soft>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
        <section className="batt-next-actions app-card soft-panel" aria-label="Next actions">
          <h2>Next actions</h2>
          <ol>
            {setupActions.map((action) => (
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
      </main>
    );
  }

  const orgId = view.context.orgId;
  const busy = busyKey != null;
  const rotationPacks = view.rotation
    .map((id) => view.packs.find((pack) => pack.id === id))
    .filter((pack): pack is Pack => Boolean(pack));
  const canDelete = view.context.role === "owner" || view.context.role === "admin";
  const nextActions = batteryNextActions({
    orgId,
    // `BatteryPackSnap.health.score` in lib/battery/battery-related.ts is still
    // `number`, but batteryHealth returns null for an unmeasured pack. The
    // helper never reads `score` (it goes through packHasMeasurement), so this
    // is only a too-narrow declaration — no value is invented here. Handoff:
    // widen that field to `number | null` and this cast goes away.
    packs: view.packs as unknown as Parameters<typeof batteryNextActions>[0]["packs"],
    logCount: view.logs.length,
    nextRotationLabel: rotationPacks[0]?.label ?? null,
  });
  const measuredCount = view.packs.filter((p) => packHasMeasurement(p)).length;

  return (
    <main className="module-page batt-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Batteries"
        description={
          <>
            Charge cycles, assignment, and event readiness for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""}. IR and cycles only from logged
            events — never demo metrics.
          </>
        }
      >
        <div className="batt-header-actions">
          <a className="app-button secondary" href={withOrgHref("/pit", orgId)}>
            Pit Command
          </a>
          <a className="app-button secondary" href={withOrgHref("/battery-rotation", orgId)}>
            Rotation
          </a>
          <a className="app-button secondary" href={withOrgHref("/battery-health-forecast", orgId)}>
            Health forecast
          </a>
          <a className="app-button secondary" href={withOrgHref("/inventory", orgId)}>
            Inventory
          </a>
        </div>
      </PageHeader>
      {!embed ? <TeamOpsNav orgId={orgId} active="batteries" /> : null}
      {!embed ? <BatteriesRelated orgId={orgId} /> : null}

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

      <section className="batt-next-actions app-card soft-panel" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p>Prioritized from your fleet — empty until packs and measurements exist.</p>
        </header>
        <ol>
          {nextActions.map((action) => (
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
        <article className="batt-summary-tile ready">
          <strong>{view.summary.cartReady}</strong>
          <span>Cart ready</span>
        </article>
        <article className={`batt-summary-tile${view.summary.cartCooling ? " warn" : ""}`}>
          <strong>{view.summary.cartCooling}</strong>
          <span>Cooling</span>
        </article>
      </section>

      {view.packs.length === 0 ? (
        <EmptyState
          title="No batteries yet"
          description="Add a pack label to start. Resistance, voltage, and cycles stay blank until someone logs them — nothing is invented."
          soft
        >
          <BatteriesRelated orgId={orgId} />
        </EmptyState>
      ) : null}

      <div className="batt-layout">
        <div className="batt-panel">
          {view.packs.some((pack) => pack.cartSlot.kind !== "parked") ? (
            <section className="app-card soft-panel">
              <h2>Competition cart</h2>
              <p className="app-muted">
                Killer Bees cool-down: 15 minutes off the charger before a Beak test, then Ready. Slots stay empty until
                you log a real charge — never DEMO ready packs.
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
                          Log a resistance test or voltage so health is evidence-based — Vantage will not invent IR.
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
                            onClick={() => {
                              setLogForm((prev) => ({
                                ...prev,
                                batteryId: pack.id,
                                kind: "resistance_test",
                              }));
                              document.getElementById("batt-log-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
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
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() =>
                      document.getElementById("batt-log-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    Log an event
                  </button>
                ) : null}
              </EmptyState>
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
            <button type="submit" className="app-button" disabled={busy || !packForm.label.trim()}>
              Add battery
            </button>
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
              <EmptyState soft title="Add a pack first" description="Events attach to a labeled pack in this workspace." />
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
