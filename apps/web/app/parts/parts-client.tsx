"use client";

// /parts — ONE PARTS LEDGER hub (0505). Four tabs over the existing surfaces:
//   Stock     unified on-hand / reserved / available / unallocated from /api/parts (+ receive,
//             consume, reserve inline), linking to Inventory for catalog edits
//   Locations bins and shelves with what they hold, linking to Inventory · Locations and Bin locator
//   Forecast  the spare-parts exhaustion forecast (/api/spare-forecast) at a glance
//   Kit       held spare-robot-kit reservations and the kit checklist (/api/spare-robot-kit)
// Self-contained: PageHeader + TabBar from components/ui; no nav registration here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel, TabBar, type SoftTab } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  RESERVATION_SOURCE_KINDS,
  type PartReservation,
  type PartStock,
  type PartsView,
  type ReservationSourceKind,
} from "../../lib/parts/compute-parts";
import { forecastUrgencyLabel } from "../../lib/spare-forecast";
import type { SpareForecastView } from "../../lib/spare-forecast/compute-spare-forecast";
import type { SpareRobotKitView } from "../../lib/spare-robot-kit/compute-spare-robot-kit";

type PartsTab = "stock" | "locations" | "forecast" | "kit";
type LiveView = Extract<PartsView, { status: "live" }>;

const TABS: SoftTab[] = [
  { id: "stock", label: "Stock" },
  { id: "locations", label: "Locations" },
  { id: "forecast", label: "Forecast" },
  { id: "kit", label: "Kit" },
];

const SOURCE_LABEL: Record<ReservationSourceKind, string> = {
  spare_robot_kit: "Spare robot kit",
  pit_repair_triage: "Pit repair",
  bom: "BOM",
  manual: "Manual hold",
};

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function tabFromLocation(): PartsTab {
  if (typeof window === "undefined") return "stock";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "locations" || tab === "forecast" || tab === "kit" ? tab : "stock";
}

export default function PartsClient() {
  const [view, setView] = useState<PartsView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<PartsTab>("stock");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setTab(tabFromLocation());
  }, []);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/parts${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as PartsView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setFetchFailed(true);
        return;
      }
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const run = useCallback(
    async (body: Record<string, unknown>, okMessage: string) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/parts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...body }),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        setNotice(okMessage);
        await load();
      } catch {
        setError("Network error — nothing was changed.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, load],
  );

  const inventoryHref = withOrgHref("/inventory", orgId);
  const spareForecastHref = hubHref("/build", "spare-forecast", orgId);
  const spareKitHref = hubHref("/build", "spare-robot-kit", orgId);
  const binLocatorHref = hubHref("/build", "bin-shelf-locator", orgId);

  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={withOrgHref("/build", orgId)}>Build</a>
          {" / Parts"}
        </>
      }
      title="Parts"
      description="One parts ledger: what is on the shelf, what is already promised to a kit or a repair, and what is genuinely free — across Inventory, Locations, Spare Forecast and the Spare Robot Kit. Real rows only, never DEMO stock."
    >
      <div className="parts-header-actions parts-links">
        <a className="app-button secondary" href={inventoryHref}>
          Inventory
        </a>
        <a className="app-button secondary" href={spareForecastHref}>
          Spare forecast
        </a>
        <a className="app-button secondary" href={spareKitHref}>
          Spare kit
        </a>
      </div>
    </PageHeader>
  );

  if (!view && !fetchFailed) {
    return (
      <main className="module-page parts-page">
        {header}
        <EmptyState soft title="Loading parts…" description="Reading the unified stock ledger." aria-busy />
      </main>
    );
  }

  if (fetchFailed || !view) {
    return (
      <main className="module-page parts-page">
        {header}
        <EmptyState soft badge="Unavailable" badgeTone="setup" title="Could not load parts" description="A network or server issue prevented loading. Nothing is fabricated while offline.">
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  if (view.status !== "live") {
    return (
      <main className="module-page parts-page">
        {header}
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message} description="Parts is org-scoped — pick a workspace first.">
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page parts-page">
      {header}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="telemetry-status" role="status">
          {notice}
        </p>
      ) : null}

      <Panel aria-label="Parts summary">
        <div className="parts-stats">
          <div>
            <span className={`app-badge ${view.summary.itemCount === 0 ? "setup" : view.summary.shortItemCount > 0 ? "danger" : "good"}`}>
              {view.summary.itemCount === 0 ? "EMPTY" : view.summary.shortItemCount > 0 ? "SHORT" : "COVERED"}
            </span>
            <h2 style={{ margin: "6px 0 0" }}>Unified stock</h2>
            <small className="app-muted">on-hand − held reservations = available · available − BOM need = unallocated</small>
          </div>
          {[
            { label: "Items", value: view.summary.itemCount },
            { label: "Low (available)", value: view.summary.lowCount },
            { label: "Held reservations", value: view.summary.heldReservationCount },
            { label: "Units on hold", value: fmtQty(view.summary.reservedQuantity) },
            { label: "BOM short", value: view.summary.shortItemCount },
          ].map((tile) => (
            <div key={tile.label}>
              <strong>{tile.value}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {tile.label}
              </small>
            </div>
          ))}
        </div>
      </Panel>

      <TabBar tabs={TABS} value={tab} onChange={(id) => setTab(id as PartsTab)} aria-label="Parts sections" />

      {tab === "stock" ? (
        <StockTab view={view} busy={busy} run={run} search={search} setSearch={setSearch} inventoryHref={inventoryHref} />
      ) : null}
      {tab === "locations" ? <LocationsTab view={view} inventoryHref={inventoryHref} binLocatorHref={binLocatorHref} /> : null}
      {tab === "forecast" ? <ForecastTab orgId={view.orgId} href={spareForecastHref} /> : null}
      {tab === "kit" ? <KitTab view={view} busy={busy} run={run} orgId={view.orgId} href={spareKitHref} /> : null}
    </main>
  );
}

// ---------------------------------------------------------------- Stock

function StockTab({
  view,
  busy,
  run,
  search,
  setSearch,
  inventoryHref,
}: {
  view: LiveView;
  busy: boolean;
  run: (body: Record<string, unknown>, okMessage: string) => Promise<void>;
  search: string;
  setSearch: (value: string) => void;
  inventoryHref: string;
}) {
  const query = search.trim().toLowerCase();
  const items = useMemo(
    () =>
      view.items.filter((item) => {
        if (!query) return true;
        return `${item.name} ${item.partNumber ?? ""} ${item.vendor ?? ""} ${item.subsystem ?? ""} ${item.locationName ?? ""}`
          .toLowerCase()
          .includes(query);
      }),
    [view.items, query],
  );

  if (view.items.length === 0) {
    return (
      <EmptyState soft badge="No parts yet" badgeTone="setup" title="Nothing on the shelf yet" description="Add items in Inventory; every quantity here is the net of real ledger movements.">
        <a className="app-button" href={inventoryHref}>
          Open Inventory
        </a>
      </EmptyState>
    );
  }

  return (
    <Panel className="parts-section" aria-label="Unified stock">
      <div className="parts-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Stock</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            Receive, consume or hold from here — each is one append-only ledger row. Catalog edits live in{" "}
            <a href={inventoryHref}>Inventory</a>.
          </p>
        </div>
        <div className="parts-toolbar">
          <input type="search" placeholder="Search name, part #, vendor, subsystem…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="parts-table-wrap">
        <table className="parts-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">On hand</th>
              <th className="num">Reserved</th>
              <th className="num">Available</th>
              <th className="num">BOM need</th>
              <th className="num">Unallocated</th>
              <th>Move</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <StockRow key={item.id} item={item} busy={busy} run={run} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function StockRow({
  item,
  busy,
  run,
}: {
  item: PartStock;
  busy: boolean;
  run: (body: Record<string, unknown>, okMessage: string) => Promise<void>;
}) {
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState<"receive" | "consume" | "reserve">("consume");
  const [sourceKind, setSourceKind] = useState<ReservationSourceKind>("manual");
  const amount = Number(qty);
  const valid = Number.isFinite(amount) && amount > 0;

  return (
    <tr className={[item.low ? "low" : "", item.shortfallQuantity > 0 ? "short" : ""].filter(Boolean).join(" ") || undefined}>
      <td>
        <strong>{item.name}</strong>
        <small className="app-muted" style={{ display: "block" }}>
          {[item.partNumber, item.vendor, item.subsystem, item.locationName].filter(Boolean).join(" · ") || item.category}
          {item.low ? " · low" : ""}
          {item.archived ? " · archived" : ""}
        </small>
      </td>
      <td className="num">
        {fmtQty(item.onHandQuantity)} <small className="app-muted">{item.unit}</small>
      </td>
      <td className="num">{fmtQty(item.reservedQuantity)}</td>
      <td className="num">
        <strong>{fmtQty(item.availableQuantity)}</strong>
      </td>
      <td className="num">{item.bomNeededQuantity > 0 ? fmtQty(item.bomNeededQuantity) : "—"}</td>
      <td className="num">
        {fmtQty(item.unallocatedQuantity)}
        {item.shortfallQuantity > 0 ? <small style={{ display: "block", color: "var(--soft-danger,#c62828)" }}>short {fmtQty(item.shortfallQuantity)}</small> : null}
      </td>
      <td>
        <form
          className="parts-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            const body: Record<string, unknown> = { action: mode, itemId: item.id, quantity: amount };
            if (mode === "reserve") body.sourceKind = sourceKind;
            void run(
              body,
              mode === "receive"
                ? `Received ${fmtQty(amount)} × ${item.name}.`
                : mode === "consume"
                  ? `Consumed ${fmtQty(amount)} × ${item.name}.`
                  : `Held ${fmtQty(amount)} × ${item.name}.`,
            ).then(() => setQty(""));
          }}
        >
          <select value={mode} disabled={busy} aria-label={`Movement for ${item.name}`} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="consume">Consume</option>
            <option value="receive">Receive</option>
            <option value="reserve">Hold</option>
          </select>
          {mode === "reserve" ? (
            <select value={sourceKind} disabled={busy} aria-label="Hold reason" onChange={(e) => setSourceKind(e.target.value as ReservationSourceKind)}>
              {RESERVATION_SOURCE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {SOURCE_LABEL[kind]}
                </option>
              ))}
            </select>
          ) : null}
          <input type="number" step="any" min={0} placeholder="qty" value={qty} disabled={busy} aria-label={`Quantity for ${item.name}`} onChange={(e) => setQty(e.target.value)} />
          <button type="submit" className="app-button secondary sm" disabled={busy || !valid}>
            Apply
          </button>
        </form>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- Locations

function LocationsTab({ view, inventoryHref, binLocatorHref }: { view: LiveView; inventoryHref: string; binLocatorHref: string }) {
  const unassigned = view.items.filter((item) => !item.archived && !item.locationId);
  return (
    <Panel className="parts-section" aria-label="Locations">
      <div className="parts-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Locations</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            Where stock physically lives. Add or rename bins in <a href={`${inventoryHref}#inventory-locations`}>Inventory · Locations</a>; print and scan labels with the{" "}
            <a href={binLocatorHref}>Bin locator</a>.
          </p>
        </div>
      </div>
      {view.locations.length === 0 ? (
        <EmptyState soft badge="No locations yet" badgeTone="setup" title="No bins or shelves defined" description="Create locations in Inventory so every part has a home.">
          <a className="app-button" href={inventoryHref}>
            Open Inventory
          </a>
        </EmptyState>
      ) : (
        <div className="parts-table-wrap">
          <table className="parts-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Kind</th>
                <th className="num">Items</th>
                <th className="num">Units on hand</th>
              </tr>
            </thead>
            <tbody>
              {view.locations.map((location) => (
                <tr key={location.id}>
                  <td>
                    <strong>{location.name}</strong>
                  </td>
                  <td>{location.kind}</td>
                  <td className="num">{location.itemCount}</td>
                  <td className="num">{fmtQty(location.onHandQuantity)}</td>
                </tr>
              ))}
              {unassigned.length > 0 ? (
                <tr>
                  <td>
                    <em>Unassigned</em>
                  </td>
                  <td>—</td>
                  <td className="num">{unassigned.length}</td>
                  <td className="num">{fmtQty(unassigned.reduce((sum, item) => sum + item.onHandQuantity, 0))}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Forecast

function ForecastTab({ orgId, href }: { orgId: string; href: string }) {
  const [forecast, setForecast] = useState<SpareForecastView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/spare-forecast?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = (await response.json()) as SpareForecastView | { error?: string };
        if (cancelled) return;
        if (!response.ok || !("status" in data)) setFailed(true);
        else setForecast(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (failed) {
    return <EmptyState soft badge="Unavailable" badgeTone="setup" title="Could not load the spare forecast" description="Open the full page to retry." />;
  }
  if (!forecast) {
    return <EmptyState soft title="Loading forecast…" description="Reading spare bins, ledger usage and FMEA cadence." aria-busy />;
  }
  if (forecast.status !== "live") {
    return (
      <EmptyState soft badge="Setup required" badgeTone="setup" title={forecast.message} description="The forecast needs spare-category bins and either ledger usage or FMEA history.">
        <a className="app-button" href={href}>
          Open Spare forecast
        </a>
      </EmptyState>
    );
  }

  const horizon = forecast.horizon;
  return (
    <Panel className="parts-section" aria-label="Spare forecast">
      <div className="parts-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Exhaustion forecast</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            {forecast.spareBinCount} spare bin{forecast.spareBinCount === 1 ? "" : "s"} · horizon{" "}
            {horizon.horizonSource === "event"
              ? `until ${horizon.eventName ?? "the active event"} ends (${horizon.horizonDays} day${horizon.horizonDays === 1 ? "" : "s"})`
              : `rolling ${horizon.horizonDays}-day offseason window — no upcoming registered event`}
            . Rates come from the inventory ledger when it has enough movements, else FMEA cadence.
          </p>
        </div>
        <a className="app-button secondary" href={href}>
          Open Spare forecast
        </a>
      </div>
      {forecast.forecastLines.length === 0 ? (
        <p className="app-muted" style={{ margin: 0 }}>
          No spare bin has a measured consumption rate yet — log part usage in Inventory or failures in FMEA and the forecast fills in.
        </p>
      ) : (
        <ul className="parts-list">
          {forecast.forecastLines.slice(0, 12).map((line) => (
            <li key={line.itemId} className="app-card soft-panel parts-card">
              <div className="parts-card-head">
                <div>
                  <span className={`app-badge ${line.forecast.urgency === "critical" ? "danger" : line.forecast.urgency === "stable" ? "good" : "setup"}`}>
                    {forecastUrgencyLabel(line.forecast.urgency)}
                  </span>
                  <strong style={{ display: "block", marginTop: 4 }}>{line.itemName}</strong>
                </div>
                <small className="app-muted">
                  {fmtQty(line.quantityOnHand)} on hand · {line.forecast.consumptionPerDay.toFixed(3)}/day from{" "}
                  {line.forecast.rateSource === "ledger" ? "inventory ledger" : "FMEA cadence"}
                </small>
              </div>
              <small className="app-muted">
                {line.forecast.willExhaust
                  ? `Projected shortfall ${fmtQty(line.forecast.projectedShortfall)} over ${line.forecast.horizonDays} days · order ${line.forecast.recommendedOrderQty}`
                  : `Covers the ${line.forecast.horizonDays}-day horizon`}
              </small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Kit

function KitTab({
  view,
  busy,
  run,
  orgId,
  href,
}: {
  view: LiveView;
  busy: boolean;
  run: (body: Record<string, unknown>, okMessage: string) => Promise<void>;
  orgId: string;
  href: string;
}) {
  const [kit, setKit] = useState<SpareRobotKitView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/spare-robot-kit?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = (await response.json()) as SpareRobotKitView | { error?: string };
        if (!cancelled && response.ok && "status" in data) setKit(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const held = view.reservations.filter((reservation) => reservation.status === "held");
  const kitHeld = held.filter((reservation) => reservation.sourceKind === "spare_robot_kit");
  const otherHeld = held.filter((reservation) => reservation.sourceKind !== "spare_robot_kit");

  return (
    <Panel className="parts-section" aria-label="Spare robot kit">
      <div className="parts-section-head">
        <div>
          <h2 style={{ margin: 0 }}>Spare robot kit</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            {kit?.status === "live"
              ? `${kit.candidateItems.length} candidate item${kit.candidateItems.length === 1 ? "" : "s"} · ${kit.checklists.length} checklist${kit.checklists.length === 1 ? "" : "s"}`
              : "Checklist candidates come from spare bins with FMEA history"}
            . Holding a part here keeps it out of "available" until it is consumed or released.
          </p>
        </div>
        <a className="app-button secondary" href={href}>
          Open Spare kit
        </a>
      </div>

      <h3 style={{ margin: 0, fontSize: 14 }}>Held for the kit</h3>
      {kitHeld.length === 0 ? (
        <p className="app-muted" style={{ margin: 0 }}>
          Nothing held for the kit yet — use <em>Hold → Spare robot kit</em> on the Stock tab.
        </p>
      ) : (
        <ReservationList reservations={kitHeld} busy={busy} run={run} />
      )}

      {otherHeld.length > 0 ? (
        <>
          <h3 style={{ margin: "8px 0 0", fontSize: 14 }}>Other holds</h3>
          <ReservationList reservations={otherHeld} busy={busy} run={run} />
        </>
      ) : null}
    </Panel>
  );
}

function ReservationList({
  reservations,
  busy,
  run,
}: {
  reservations: PartReservation[];
  busy: boolean;
  run: (body: Record<string, unknown>, okMessage: string) => Promise<void>;
}) {
  return (
    <ul className="parts-list">
      {reservations.map((reservation) => (
        <li key={reservation.id} className="app-card soft-panel parts-card">
          <div className="parts-card-head">
            <div>
              <strong>
                {fmtQty(reservation.quantity)} × {reservation.itemName}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {SOURCE_LABEL[reservation.sourceKind]}
                {reservation.note ? ` · ${reservation.note}` : ""} · held {new Date(reservation.createdAt).toLocaleDateString()}
              </small>
            </div>
            <div className="parts-links">
              <button
                type="button"
                className="app-button secondary sm"
                disabled={busy}
                title="The part left the shelf — record the movement on the ledger"
                onClick={() => void run({ action: "consume-reservation", reservationId: reservation.id }, `Consumed ${reservation.itemName}.`)}
              >
                Consume
              </button>
              <button
                type="button"
                className="app-button secondary sm"
                disabled={busy}
                onClick={() => void run({ action: "release", reservationId: reservation.id }, `Released ${reservation.itemName}.`)}
              >
                Release
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
