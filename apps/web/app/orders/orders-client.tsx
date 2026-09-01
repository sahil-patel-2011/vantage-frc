"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { ORDERS_RELATED_INCLUDE } from "../../lib/business/business-related";
import { validateBuySheet } from "../../lib/finance/buy-sheet";
import { hubHref } from "../../lib/nav/hubs";
import {
  ordersNextActions,
  showBuyPanel,
  statusLabel,
  type OrderRequest,
  type OrdersView,
} from "../../lib/orders";
import "./orders.css";

type DirectoryVendor = { id: string; name: string; preferred: boolean };
type CatalogItem = { id: string; name: string };

const CATALOG_ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catalog rows from /api/inventory. Empty or malformed payloads stay empty — never invent an id. */
function catalogItemsFromInventory(data: unknown): CatalogItem[] {
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const catalog: CatalogItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { id?: unknown; name?: unknown; archived?: unknown };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!CATALOG_ITEM_ID.test(id)) continue;
    if (raw.archived === true) continue;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    catalog.push({ id, name });
  }
  return catalog;
}

type LiveView = Extract<OrdersView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

export type OrdersClientProps = {
  /** When embedded in Business hub, hide page chrome and inherit season. */
  embedded?: boolean;
  seasonYear?: number;
  orgId?: string | null;
};

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatWhen(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Prefer bought → needed-by → requested. Never invent a date. */
function orderWhen(order: OrderRequest): string {
  if (order.orderedAt) return `Bought ${formatWhen(order.orderedAt)}`;
  if (order.neededBy) return `Needed ${formatWhen(order.neededBy)}`;
  return `Requested ${formatWhen(order.createdAt)}`;
}

function OrdersNextActions({
  actions,
}: {
  actions: ReturnType<typeof ordersNextActions>;
}) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions orders-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next</span>
        <h2>Keep the buy sheet moving</h2>
        <p>Approve, then pay on the vendor site. Lines come from real purchases only — never DEMO items.</p>
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

function ApprovalFlowStrip() {
  return (
    <section className="soft-panel orders-flow" aria-label="Buy sheet columns">
      <span className="biz-overline">Buy sheet</span>
      <h2>What we bought, why, when, cost</h2>
      <ol className="orders-flow-steps">
        <li>
          <strong>What</strong>
          <span>The part or item — a real line only, never a DEMO item.</span>
        </li>
        <li>
          <strong>Why</strong>
          <span>Subsystem, event deadline, or pit spare — so mentors can approve.</span>
        </li>
        <li>
          <strong>When</strong>
          <span>Needed-by if you set one, otherwise the date it was requested or bought.</span>
        </li>
        <li>
          <strong>Cost</strong>
          <span>Estimate on this sheet. Pay on the vendor site — never enter card details here.</span>
        </li>
      </ol>
    </section>
  );
}

export default function OrdersClient({ embedded = false, seasonYear, orgId: orgIdProp }: OrdersClientProps = {}) {
  const [view, setView] = useState<OrdersView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(seasonYear ?? null);

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? orgIdProp ?? null;

  const load = useCallback(
    (seasonOverride?: number) => {
      setError("");
      setErrorStatus(null);
      const params = new URLSearchParams(window.location.search);
      const urlOrg = orgIdProp ?? params.get("orgId");
      const orderId = params.get("orderId");
      const seasonQuery =
        seasonOverride ??
        seasonYear ??
        (params.get("season") ? Number(params.get("season")) : null);
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (orderId) query.set("orderId", orderId);
      if (seasonQuery && Number.isFinite(seasonQuery)) query.set("season", String(seasonQuery));
      void fetch(`/api/orders${query.toString() ? `?${query.toString()}` : ""}`)
        .then(async (response) => {
          const data = (await response.json()) as OrdersView & { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Could not load the buy sheet");
            setErrorStatus(response.status);
            return;
          }
          setView(data);
          if (data.status === "live") setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."));
    },
    [orgIdProp, seasonYear],
  );

  useEffect(() => {
    load(seasonYear);
  }, [load, seasonYear]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? seasonYear ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as OrdersView & { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          if (data.status === "live") setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy, season, seasonYear],
  );

  const live = view?.status === "live" ? view : null;
  const seasonOptions = useMemo(() => {
    const year = live?.seasonYear ?? season ?? new Date().getFullYear();
    return [year - 1, year, year + 1];
  }, [live?.seasonYear, season]);

  const nextActionCtx = useMemo(() => {
    if (view?.status === "setup_required") {
      return { orgId: view.orgId ?? orgIdProp ?? null, orderCount: 0, seasonYear: seasonYear ?? undefined };
    }
    if (!live) return { orgId: orgIdProp ?? null, orderCount: 0 };
    const missingBuyLinkCount = live.orders.filter((o) => o.status === "approved" && !o.itemUrl).length;
    return {
      orgId: live.orgId,
      isAdmin: live.isAdmin,
      orderCount: live.orders.length,
      pendingCount: live.metrics.pending,
      readyToBuyCount: live.metrics.readyToBuy,
      missingBuyLinkCount,
      seasonYear: live.seasonYear,
    };
  }, [view, live, orgIdProp, seasonYear]);

  const nextActions = useMemo(() => ordersNextActions(nextActionCtx), [nextActionCtx]);
  const relatedOrg = live?.orgId ?? (view?.status === "setup_required" ? view.orgId : null) ?? orgIdProp ?? null;

  const related = relatedOrg ? (
    <BusinessRelated
      orgId={relatedOrg}
      active="orders"
      include={ORDERS_RELATED_INCLUDE}
      ariaLabel="Related business tools"
    />
  ) : null;

  const body = (
    <>
      {error && view ? (
        <p className="orders-error" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        error ? (
          (() => {
            const copy = loadFailureCopy(
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
                message: error,
              },
            );
            return (
              <EmptyState soft title={copy.title} description={copy.description}>
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button type="button" className="app-button secondary" onClick={() => load()}>
                    Retry
                  </button>
                ) : null}
              </EmptyState>
            );
          })()
        ) : (
          <EmptyState soft title="Opening buy sheet…" description="Loading this season’s purchases — what, why, when, and cost." aria-busy />
        )
      ) : view.status === "setup_required" ? (
        <>
          {related}
          <EmptyState
            soft
            badge="Setup required"
            badgeTone="setup"
            title={view.message}
            description="Choose a workspace, then log what, why, when, and cost. The sheet stays empty until someone adds a real line — never DEMO items."
          >
            <ol className="strategy-setup-steps">
              {view.steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <a href={step.href}>Open</a>
                </li>
              ))}
            </ol>
          </EmptyState>
          <OrdersNextActions actions={nextActions} />
        </>
      ) : (
        <>
          {related}
          {!embedded ? (
            <label className="orders-season">
              Season
              <select
                value={live!.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {seasonOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ApprovalFlowStrip />
          <OrdersNextActions actions={nextActions} />
          {live!.orders.length > 0 ? <MetricsPanel view={live!} /> : null}
          {live!.orders.length === 0 ? (
            <EmptyState
              soft
              title="Buy sheet is empty"
              description="Add what the team bought or needs: what, why, when, and the cost. Totals stay blank until someone logs a real estimate — never DEMO line items."
            >
              <BusinessRelated
                orgId={live!.orgId}
                include={["sponsors", "fundraisers", "budget"]}
                ariaLabel="Empty orders links"
              />
            </EmptyState>
          ) : null}
          {live!.financeAiEnabled && live!.aiSummary ? <AiSummaryPanel summary={live!.aiSummary} /> : null}
          {live!.metrics.mineToBuy > 0 ? (
            <p className="orders-warn" role="status">
              {live!.metrics.mineToBuy} approved line{live!.metrics.mineToBuy === 1 ? "" : "s"} waiting on you —
              open the buy link, pay on the vendor site, then mark ordered.
            </p>
          ) : null}
          {live!.isAdmin && live!.metrics.pending > 0 ? (
            <p className="orders-info" role="status">
              {live!.metrics.pending} line{live!.metrics.pending === 1 ? "" : "s"} awaiting your approval before a
              buy link is unlocked.
            </p>
          ) : null}
          <SubmitForm
            orgId={live!.orgId}
            seasonYear={season ?? live!.seasonYear}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onCreated={() => load()}
          />
          <OrdersList view={live!} busy={busy} mutate={mutate} />
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="orders-embedded">{body}</div>;
  }

  return (
    <main className="module-page orders-page">
      <PageHeader
        navPath="/orders"
        title="Buy sheet"
        description="What we bought, why, when, and what it cost. Mentors approve, then pay on the vendor site — never card details or DEMO line items."
      />
      {body}
    </main>
  );
}

function MetricsPanel({ view }: { view: LiveView }) {
  const m = view.metrics;
  const tiles = [
    { label: "Awaiting approval", value: String(m.pending) },
    { label: "Ready to buy", value: String(m.readyToBuy) },
    { label: "Ordered", value: String(m.ordered) },
    { label: "Received", value: String(m.received) },
    { label: "Open cost", value: usd(m.openTotalUsd) },
  ];
  return (
    <section className="soft-panel">
      <span className="biz-overline">This season</span>
      <h2>Real purchases</h2>
      <p className="orders-metrics-note">Counts and open $ come from submitted lines only — never DEMO items.</p>
      <div className="orders-metrics">
        {tiles.map((tile) => (
          <div key={tile.label} className="orders-metric">
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AiSummaryPanel({ summary }: { summary: NonNullable<LiveView["aiSummary"]> }) {
  return (
    <section className="soft-panel orders-ai">
      <h2>Finance assistant</h2>
      <p>{summary.headline}</p>
      <ul>
        {summary.recommendations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <small className="app-muted">
        Local Season Costs opt-in — separate from AI chat Finance-in-AI under Team → AI governance.
      </small>
    </section>
  );
}

function SubmitForm({
  orgId,
  seasonYear,
  busy,
  setBusy,
  setError,
  onCreated,
}: {
  orgId: string;
  seasonYear: number;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  onCreated: () => void;
}) {
  const [vendors, setVendors] = useState<DirectoryVendor[]>([]);
  const [vendorsReady, setVendorsReady] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const directoryHref = hubHref("/business", "vendors", orgId);

  useEffect(() => {
    let cancelled = false;
    setVendorsReady(false);
    setCatalogItems([]);
    void fetch(`/api/vendors?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          status?: string;
          vendors?: DirectoryVendor[];
        };
        if (cancelled) return;
        setVendors(
          data.status === "live" && Array.isArray(data.vendors)
            ? data.vendors.map((vendor) => ({
                id: vendor.id,
                name: vendor.name,
                preferred: Boolean(vendor.preferred),
              }))
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      })
      .finally(() => {
        if (!cancelled) setVendorsReady(true);
      });
    void fetch(`/api/inventory?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        if (!cancelled) setCatalogItems(catalogItemsFromInventory(data));
      })
      .catch(() => {
        if (!cancelled) setCatalogItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const sheet = validateBuySheet({
      title: data.title,
      justification: data.justification,
      neededBy: data.neededBy,
      estimateUsd: data.estimateUsd,
    });
    if (!sheet.ok) {
      setError(sheet.error);
      return;
    }
    setBusy(true);
    setError("");
    const catalogId =
      typeof data.inventoryItemId === "string"
        ? catalogItems.find((item) => item.id === data.inventoryItemId)?.id
        : undefined;
    void fetch("/api/finance/purchase-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        seasonYear,
        title: sheet.value.title,
        justification: sheet.value.justification,
        estimateUsd: sheet.value.costUsd,
        vendorId: data.vendorId,
        itemUrl: data.itemUrl,
        neededBy: sheet.value.neededBy ?? undefined,
        ...(catalogId ? { inventoryItemId: catalogId } : {}),
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; request?: unknown };
        if (!response.ok || !payload.request) {
          setError(payload.error ?? "Choose a vendor from the vendor directory.");
          return;
        }
        form.reset();
        onCreated();
      })
      .catch(() => setError("Network error — please try again."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="soft-panel">
      <span className="biz-overline">Add a line</span>
      <h2>Log a purchase</h2>
      <p className="orders-form-lead">
        What, why, when you need it, and the cost. Mentors approve; pay on the vendor site — never paste card or bank
        numbers.
      </p>
      {vendorsReady && vendors.length === 0 ? (
        <p className="orders-warn" role="status">
          Add a vendor in the{" "}
          <a href={directoryHref}>vendor directory</a> before logging a line — free-text supplier names are not
          accepted.
        </p>
      ) : null}
      <form className="orders-form" onSubmit={onSubmit}>
        <label>
          What
          <input name="title" required maxLength={200} placeholder='e.g. 1/2" hex shaft stock' />
        </label>
        <label>
          Why
          <textarea
            name="justification"
            required
            maxLength={2000}
            placeholder="Subsystem, event, or spare — never paste card or bank numbers"
          />
        </label>
        <div className="orders-form-grid">
          <label>
            When <small>needed by, optional</small>
            <input name="neededBy" type="date" />
          </label>
          <label>
            Cost ($)
            <input name="estimateUsd" type="number" min={0} step="0.01" required placeholder="42.00" />
          </label>
          <label>
            Vendor
            <select name="vendorId" required disabled={!vendorsReady || vendors.length === 0} defaultValue="">
              <option value="" disabled>
                {vendorsReady ? "Choose from the vendor directory" : "Loading vendors…"}
              </option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.preferred ? `${vendor.name} (preferred)` : vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buy link <small>optional product URL</small>
            <input name="itemUrl" type="url" placeholder="https://…" />
          </label>
          {catalogItems.length > 0 ? (
            <label>
              Restock inventory <small>optional — receive writes stock</small>
              <select name="inventoryItemId" defaultValue="">
                <option value="">None — skip stock receive</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <button type="submit" className="orders-submit" disabled={busy || vendors.length === 0}>
          Add to buy sheet
        </button>
      </form>
    </section>
  );
}

function OrdersList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const pending = view.orders.filter((o) => o.status === "pending");
  const active = view.orders.filter((o) => o.status !== "pending" && o.status !== "rejected");
  const closed = view.orders.filter((o) => o.status === "rejected");

  return (
    <>
      <section className="soft-panel">
        <span className="biz-overline">Mentor gate</span>
        <h2>Awaiting approval</h2>
        <p className="orders-section-lead">
          Mentors review what, why, when, and cost, then unlock the vendor buy link. Nothing is charged here.
        </p>
        {pending.length === 0 ? (
          <p className="app-muted">No lines waiting on mentors.</p>
        ) : (
          <ul className="orders-list">
            {pending.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                view={view}
                busy={busy}
                mutate={mutate}
                focused={view.focusOrderId === order.id}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="soft-panel">
        <span className="biz-overline">On the sheet</span>
        <h2>Bought &amp; in progress</h2>
        <p className="orders-section-lead">
          After approval, open the buy link, pay on the vendor site, then mark ordered and received.
        </p>
        {active.length === 0 ? (
          <p className="app-muted">Approved, bought, and received lines appear here.</p>
        ) : (
          <ul className="orders-list">
            {active.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                view={view}
                busy={busy}
                mutate={mutate}
                focused={view.focusOrderId === order.id}
              />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section className="soft-panel">
          <h2>Rejected</h2>
          <ul className="orders-list">
            {closed.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                view={view}
                busy={busy}
                mutate={mutate}
                focused={view.focusOrderId === order.id}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function OrderCard({
  order,
  view,
  busy,
  mutate,
  focused,
}: {
  order: OrderRequest;
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  focused: boolean;
}) {
  const canBuy =
    showBuyPanel(order.status) &&
    (view.isAdmin ||
      order.buyerUserId === view.currentUserId ||
      (!order.buyerUserId && order.requestedBy === view.currentUserId));

  const canProgressOrdered = order.status === "approved" && canBuy;
  const canProgressReceived = order.status === "ordered" && canBuy;

  const buyerOptions = useMemo(
    () => view.members.filter((member) => member.userId !== order.requestedBy),
    [view.members, order.requestedBy],
  );

  return (
    <li className={`orders-card${focused ? " focused" : ""}`}>
      <div className="orders-card-head">
        <strong>{order.title}</strong>
        <span className={`orders-status ${order.status}`}>{statusLabel(order.status)}</span>
      </div>
      {order.justification ? (
        <p className="app-muted">
          <span className="orders-why-label">Why</span> {order.justification}
        </p>
      ) : null}
      <div className="orders-meta">
        <span>{usd(order.totalCostUsd)} cost</span>
        <span>{orderWhen(order)}</span>
        <span>{order.vendor}</span>
        <span>Requested by {order.requestedByName ?? "team member"}</span>
        {order.buyerName ? <span>Buyer: {order.buyerName}</span> : null}
        {order.reviewNotes ? <span>Note: {order.reviewNotes}</span> : null}
      </div>

      {order.status === "pending" && !view.isAdmin ? (
        <p className="orders-waiting app-muted">Waiting on a mentor to approve this line before a buy link unlocks.</p>
      ) : null}

      {showBuyPanel(order.status) ? (
        <BuyPanel order={order} canBuy={canBuy} busy={busy} mutate={mutate} />
      ) : null}

      {view.isAdmin && order.status === "pending" ? (
        <AdminReview order={order} buyerOptions={buyerOptions} busy={busy} mutate={mutate} />
      ) : null}

      {view.isAdmin && (order.status === "approved" || order.status === "ordered") && !order.buyerUserId ? (
        <AssignBuyer order={order} buyerOptions={buyerOptions} busy={busy} mutate={mutate} />
      ) : null}

      <div className="orders-actions">
        {canProgressOrdered ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => mutate({ action: "mark-ordered", orderId: order.id })}
          >
            Mark ordered
          </button>
        ) : null}
        {canProgressReceived ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => mutate({ action: "mark-received", orderId: order.id })}
          >
            Mark received
          </button>
        ) : null}
      </div>
    </li>
  );
}

function BuyPanel({
  order,
  canBuy,
  busy,
  mutate,
}: {
  order: OrderRequest;
  canBuy: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  const [itemUrl, setItemUrl] = useState(order.itemUrl ?? "");

  return (
    <div className="orders-buy-panel">
      <h3>Buy on the vendor site</h3>
      <ol>
        <li>Open the product page and confirm part number and quantity.</li>
        <li>Pay on the vendor site — never enter card or bank details here.</li>
        <li>Save the receipt for finance.</li>
        <li>Return here and mark ordered, then received when it arrives.</li>
      </ol>
      {order.itemUrl ? (
        <a className="orders-buy-link" href={order.itemUrl} target="_blank" rel="noopener noreferrer">
          Open buy link ↗
        </a>
      ) : canBuy ? (
        <form
          className="orders-admin-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!itemUrl.trim()) return;
            mutate({ action: "update-item-url", orderId: order.id, itemUrl: itemUrl.trim() });
          }}
        >
          <input
            type="url"
            placeholder="https://… product URL"
            value={itemUrl}
            onChange={(event) => setItemUrl(event.target.value)}
            required
            aria-label="Buy link URL"
          />
          <button type="submit" disabled={busy || !itemUrl.trim()}>
            Save buy link
          </button>
        </form>
      ) : (
        <span className="app-muted">No buy link on file — ask an admin or buyer to add a product URL.</span>
      )}
      {!canBuy ? <span className="app-muted">Waiting on the assigned buyer or an admin.</span> : null}
    </div>
  );
}

function AdminReview({
  order,
  buyerOptions,
  busy,
  mutate,
}: {
  order: OrderRequest;
  buyerOptions: LiveView["members"];
  busy: boolean;
  mutate: Mutate;
}) {
  const [buyerUserId, setBuyerUserId] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  return (
    <div className="orders-approve-panel">
      <h3>Mentor approval</h3>
      <p>
        Approving this line unlocks the buy link. Payment stays on the vendor site — never collected here.
      </p>
      <div className="orders-admin-row">
        <select value={buyerUserId} onChange={(event) => setBuyerUserId(event.target.value)} aria-label="Assign buyer">
          <option value="">Buyer defaults to requester</option>
          {buyerOptions.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name} ({member.role})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Review note (optional)"
          value={reviewNotes}
          onChange={(event) => setReviewNotes(event.target.value)}
          maxLength={1000}
          aria-label="Review note"
        />
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "approve-order",
              orderId: order.id,
              buyerUserId: buyerUserId || null,
              reviewNotes: reviewNotes || null,
            })
          }
        >
          Approve → unlock buy link
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "reject-order",
              orderId: order.id,
              reviewNotes: reviewNotes || null,
            })
          }
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function AssignBuyer({
  order,
  buyerOptions,
  busy,
  mutate,
}: {
  order: OrderRequest;
  buyerOptions: LiveView["members"];
  busy: boolean;
  mutate: Mutate;
}) {
  const [buyerUserId, setBuyerUserId] = useState("");

  return (
    <div className="orders-admin-row">
      <select value={buyerUserId} onChange={(event) => setBuyerUserId(event.target.value)} aria-label="Assign buyer">
        <option value="">Choose buyer…</option>
        {buyerOptions.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !buyerUserId}
        onClick={() => mutate({ action: "assign-buyer", orderId: order.id, buyerUserId })}
      >
        Assign buyer
      </button>
    </div>
  );
}
