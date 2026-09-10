"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
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
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import {
  KANBAN_STATES,
  MANUFACTURING_METHODS,
  MANUFACTURING_PRIORITIES,
  MIN_COMPLETED_FOR_CYCLE_TIME,
  advanceLabel,
  advanceTarget,
  groupByState,
  methodLabel,
  priorityLabel,
  stateLabel,
} from "../../lib/manufacturing";
import type { ManufacturingView } from "../../lib/manufacturing/compute-manufacturing";
import type {
  ManufacturingMethod,
  ManufacturingPart,
  ManufacturingPriority,
} from "../../lib/manufacturing/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./manufacturing.css";

type LiveView = Extract<ManufacturingView, { status: "live" }>;

function isManufacturingView(value: unknown): value is ManufacturingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function manufacturingCacheOrg(data: ManufacturingView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistManufacturingSnapshot(orgHint: string, data: ManufacturingView): Promise<void> {
  const cacheOrg = manufacturingCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("manufacturing", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("manufacturing", "_", data);
  } catch {
    // Live Manufacturing already painted; IndexedDB is best-effort.
  }
}

const PRIORITY_TONE: Record<ManufacturingPriority, BadgeTone> = {
  critical: "danger",
  high: "setup",
  normal: "neutral",
  low: "neutral",
};

function ManufacturingShell({
  shell,
  message,
  onRetry,
  fromCache,
  cachedAt,
}: {
  shell: "loading" | "error" | "setup";
  message?: string;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  return (
    <main className="module-page mfg-page soft-gate">
      <PageHeader
        title="Part manufacturing"
        description="Track every robot part from needs-design to done — CAM, cutting, and finishing on one board."
      />
      <OfflineBanner feature="Manufacturing" fromCache={fromCache} cachedAt={cachedAt} />
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Part Manufacturing">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={message ?? "Could not load Part Manufacturing."} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Choose your team"
          description={message ?? "Choose your team to track parts through manufacturing."}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      )}
    </main>
  );
}

export default function ManufacturingClient() {
  const [view, setView] = useState<ManufacturingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ManufacturingView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ManufacturingView>("manufacturing", urlOrg || "_");
        if (!viewRef.current && cached?.data && isManufacturingView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(`/api/manufacturing${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ManufacturingView | { error?: string };
        if (!response.ok || !isManufacturingView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Manufacturing. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistManufacturingSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Manufacturing. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/manufacturing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ManufacturingView | { error?: string };
        if (!response.ok || !isManufacturingView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistManufacturingSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (view == null && !fetchFailed) {
    return <ManufacturingShell shell="loading" fromCache={fromCache} cachedAt={cachedAt} />;
  }
  if (fetchFailed && !view) {
    return (
      <ManufacturingShell
        shell="error"
        message={error || undefined}
        onRetry={() => load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }
  if (view?.status !== "live") {
    return (
      <ManufacturingShell
        shell="setup"
        message={view?.message}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  return (
    <main className="module-page mfg-page">
      <PageHeader
        title="Part manufacturing"
        description="Track every robot part from needs-design to done — CAM, cutting, and finishing on one board."
      />
      <OfflineBanner feature="Manufacturing" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RiskStrip view={view} />
      <AddPartForm view={view} busy={busy} mutate={mutate} />
      <Board view={view} busy={busy} mutate={mutate} />
      <SeedFromBomPanel view={view} busy={busy} mutate={mutate} />
      <CycleTimePanel view={view} />
      <CoveragePanel view={view} />
    </main>
  );
}

function RiskStrip({ view }: { view: LiveView }) {
  const open = view.parts.filter((part) => part.state !== "done" && part.state !== "scrapped");
  if (view.parts.length === 0) return null;
  return (
    <Panel className="mfg-panel" aria-label="Needed-by risk">
      <div className="mfg-stats">
        <StatTile label="Open parts" value={String(open.length)} />
        <StatTile label="Past needed-by" value={String(view.atRisk.length)} />
        <StatTile label="No due date" value={String(view.noDueDate.length)} />
        <StatTile label="Done" value={String(view.parts.filter((p) => p.state === "done").length)} />
      </div>
      {view.atRisk.length > 0 ? (
        <ul className="mfg-risk-list" aria-label="Parts past their needed-by date">
          {view.atRisk.slice(0, 6).map((part) => (
            <li key={part.id}>
              <Badge tone="danger">Past due {part.neededBy}</Badge>
              <span>
                {part.partName} · {stateLabel(part.state)}
                {part.subsystemName ? ` · ${part.subsystemName}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted mfg-tip">
          {view.noDueDate.length > 0
            ? `No parts are past their needed-by date. ${view.noDueDate.length} open part(s) have no due date set — they are flagged, never given one automatically.`
            : "No parts are past their needed-by date."}
        </p>
      )}
    </Panel>
  );
}

function Board({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const groups = useMemo(() => groupByState(view.parts), [view.parts]);

  if (view.parts.length === 0) {
    return (
      <EmptyState
        soft
        badge="No parts yet"
        badgeTone="setup"
        title="Add your first part"
        description="Every card starts in Needs design and moves through CAM, cutting, and finishing to Done — real parts only, never placeholders."
      />
    );
  }

  return (
    <section className="mfg-board-wrap" aria-label="Manufacturing board">
      <div className="mfg-board">
        {KANBAN_STATES.map((state) => {
          const parts = groups.get(state) ?? [];
          return (
            <section key={state} className={`mfg-column mfg-column-${state}`} aria-label={stateLabel(state)}>
              <header className="mfg-column-head">
                <h2>{stateLabel(state)}</h2>
                <span className="app-muted">{parts.length}</span>
              </header>
              {parts.length === 0 ? (
                <p className="app-muted mfg-tip">Empty</p>
              ) : (
                <ul className="mfg-cards">
                  {parts.map((part) => (
                    <PartCard key={part.id} part={part} view={view} busy={busy} mutate={mutate} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function PartCard({
  part,
  view,
  busy,
  mutate,
}: {
  part: ManufacturingPart;
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const target = advanceTarget(part.state);
  const label = advanceLabel(part.state);
  const pastDue = part.neededBy != null && part.neededBy < view.today && part.state !== "done" && part.state !== "scrapped";

  return (
    <li className="mfg-card">
      <div className="mfg-card-top">
        <strong>{part.partName}</strong>
        {part.priority !== "normal" ? (
          <Badge tone={PRIORITY_TONE[part.priority]}>{priorityLabel(part.priority)}</Badge>
        ) : null}
      </div>
      <small className="app-muted">
        {part.quantity} × {methodLabel(part.method)}
        {part.subsystemName ? ` · ${part.subsystemName}` : ""}
        {part.material ? ` · ${part.material}` : ""}
      </small>
      <small className={pastDue ? "mfg-past-due" : "app-muted"}>
        {part.neededBy ? `Needed by ${part.neededBy}` : "No due date"}
        {part.assignedName ? ` · ${part.assignedName}` : " · Unassigned"}
      </small>
      {part.state === "scrapped" && part.scrapReason ? (
        <small className="app-muted">Scrapped: {part.scrapReason}</small>
      ) : null}
      <div className="mfg-card-actions">
        {target && label ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={`${label}: ${part.partName}`}
            onClick={() => mutate({ action: "move-state", partId: part.id, toState: target })}
          >
            {label}
          </Button>
        ) : null}
        {part.state === "done" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Reopen ${part.partName} for finishing`}
            onClick={() => mutate({ action: "reopen", partId: part.id, toState: "needs_finishing" })}
          >
            Reopen
          </Button>
        ) : null}
        {part.state === "scrapped" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Remake ${part.partName}`}
            onClick={() => mutate({ action: "reopen", partId: part.id, toState: "needs_design" })}
          >
            Remake
          </Button>
        ) : null}
        {part.state !== "done" && part.state !== "scrapped" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Scrap ${part.partName}`}
            onClick={() => {
              const reason = window.prompt(`Scrap "${part.partName}" — why? (optional)`);
              if (reason === null) return;
              mutate({ action: "scrap", partId: part.id, reason: reason || undefined });
            }}
          >
            Scrap
          </Button>
        ) : null}
      </div>
      {view.members.length > 0 && part.state !== "done" && part.state !== "scrapped" ? (
        <label className="mfg-assign">
          <span className="app-muted">Assigned</span>
          <select
            value={part.assignedTo ?? ""}
            disabled={busy}
            aria-label={`Assign ${part.partName}`}
            onChange={(event) =>
              mutate({ action: "assign", partId: part.id, assignedTo: event.target.value || undefined })
            }
          >
            <option value="">Unassigned</option>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  );
}

function AddPartForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      partName: "",
      quantity: "1",
      method: "other" as ManufacturingMethod,
      priority: "normal" as ManufacturingPriority,
      subsystemId: "",
      material: "",
      neededBy: "",
      stockNote: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="manufacturing-add"
      className="mfg-panel"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.partName.trim()) return;
        mutate({
          action: "add-part",
          partName: form.partName,
          quantity: Number(form.quantity) || 1,
          method: form.method,
          priority: form.priority,
          subsystemId: form.subsystemId || undefined,
          material: form.material || undefined,
          neededBy: form.neededBy || undefined,
          stockNote: form.stockNote || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Add a part</h2>
      <p className="app-muted mfg-tip">New parts start in Needs design.</p>
      <FormGrid min={150}>
        <FormRow label="Part name">
          <input value={form.partName} onChange={set("partName")} placeholder="Drive rail, left" maxLength={160} required />
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={1} value={form.quantity} onChange={set("quantity")} />
        </FormRow>
        <FormRow label="Method">
          <select value={form.method} onChange={set("method")}>
            {MANUFACTURING_METHODS.map((method) => (
              <option key={method} value={method}>
                {methodLabel(method)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {MANUFACTURING_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabel(priority)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem (optional)">
          <select value={form.subsystemId} onChange={set("subsystemId")}>
            <option value="">None</option>
            {view.subsystems.map((subsystem) => (
              <option key={subsystem.id} value={subsystem.id}>
                {subsystem.name} ({subsystem.seasonYear})
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Material (optional)">
          <input value={form.material} onChange={set("material")} placeholder="1/8 in 6061 plate" maxLength={200} />
        </FormRow>
        <FormRow label="Needed by (optional)">
          <input type="date" value={form.neededBy} onChange={set("neededBy")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Stock note (optional)">
        <textarea value={form.stockNote} onChange={set("stockNote")} rows={2} placeholder="Stock on the raw-stock shelf, bay 2" />
      </FormRow>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !form.partName.trim()}>
          Add a part
        </Button>
      </div>
    </Panel>
  );
}

function SeedFromBomPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const bomSubsystems = useMemo(
    () => [...new Set(view.bomOptions.map((option) => option.subsystem))].sort(),
    [view.bomOptions],
  );
  const [bomSubsystem, setBomSubsystem] = useState("");
  const [robotSubsystemId, setRobotSubsystemId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (view.bomOptions.length === 0) {
    return (
      <Panel className="mfg-panel" aria-label="Seed from BOM">
        <h2>Seed from BOM</h2>
        <p className="app-muted mfg-tip">
          No BOM entries yet. Add entries in Inventory &amp; BOM first, then seed manufacturing cards from them here — one
          tap per batch, never automatic.
        </p>
        <div>
          <Button as="a" variant="secondary" href="/inventory">
            Open Inventory &amp; BOM
          </Button>
        </div>
      </Panel>
    );
  }

  const entries = view.bomOptions.filter((option) => !bomSubsystem || option.subsystem === bomSubsystem);
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Panel className="mfg-panel" aria-label="Seed from BOM">
      <h2>Seed from BOM</h2>
      <p className="app-muted mfg-tip">
        Pick real BOM entries and create one manufacturing card each, starting in Needs design. Deliberately one tap —
        the BOM never seeds the board automatically.
      </p>
      <FormGrid min={180}>
        <FormRow label="BOM subsystem">
          <select
            value={bomSubsystem}
            onChange={(event) => {
              setBomSubsystem(event.target.value);
              setSelected(new Set());
            }}
          >
            <option value="">All subsystems</option>
            {bomSubsystems.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Link cards to robot subsystem (optional)">
          <select value={robotSubsystemId} onChange={(event) => setRobotSubsystemId(event.target.value)}>
            <option value="">None</option>
            {view.subsystems.map((subsystem) => (
              <option key={subsystem.id} value={subsystem.id}>
                {subsystem.name} ({subsystem.seasonYear})
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <ul className="mfg-seed-list">
        {entries.map((option) => (
          <li key={option.id}>
            <label className="mfg-seed-row">
              <input
                type="checkbox"
                checked={selected.has(option.id)}
                disabled={busy}
                onChange={() => toggle(option.id)}
              />
              <span>
                <strong>{option.itemName}</strong>
                <small className="app-muted mfg-block">
                  {option.subsystem} · qty {option.quantityNeeded}
                  {option.partNumber ? ` · ${option.partNumber}` : ""}
                  {option.alreadySeeded ? " · already on the board" : ""}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="secondary"
          disabled={busy || selected.size === 0}
          onClick={() => {
            mutate({
              action: "bulk-add-from-bom",
              bomEntryIds: [...selected],
              subsystemId: robotSubsystemId || undefined,
            });
            setSelected(new Set());
          }}
        >
          Create {selected.size || ""} card{selected.size === 1 ? "" : "s"} from BOM
        </Button>
      </div>
    </Panel>
  );
}

function CycleTimePanel({ view }: { view: LiveView }) {
  if (view.parts.length === 0) return null;
  return (
    <Panel className="mfg-panel" aria-label="Cycle time">
      <h2>Cycle time</h2>
      {view.cycleTime == null ? (
        <p className="app-muted mfg-tip">
          Not enough finished parts yet — averages appear after {MIN_COMPLETED_FOR_CYCLE_TIME} parts reach Done. No
          estimates before that.
        </p>
      ) : (
        <>
          <p className="app-muted mfg-tip">
            Average hours per state across {view.cycleTime.completedParts} finished part(s), from the state history.
          </p>
          <div className="mfg-stats">
            {view.cycleTime.byState.map((row) => (
              <StatTile key={row.state} label={stateLabel(row.state)} value={`${row.avgHours} h`} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function CoveragePanel({ view }: { view: LiveView }) {
  if (view.coverage.length === 0) return null;
  return (
    <Panel className="mfg-panel" aria-label="Subsystem coverage">
      <h2>Subsystem coverage</h2>
      <ul className="mfg-coverage">
        {view.coverage.map((row) => (
          <li key={row.subsystemId ?? "unassigned"}>
            <strong>{row.subsystemName}</strong>
            <span className="app-muted">
              {row.done}/{row.total} done · {row.active} active
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
