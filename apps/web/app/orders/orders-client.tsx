"use client";
import { Button } from "../../components/ui";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BusinessRelated } from "../../components/business-related";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { ORDERS_RELATED_INCLUDE } from "../../lib/business/business-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  ordersNextActions,
  showBuyPanel,
  statusLabel,
  type OrderRequest,
  type OrdersView,
} from "../../lib/orders";
import { SubmitForm } from "./orders-submit-form";
import { formatInviteRole } from "../../lib/invite/invite-flow";
import "./orders.css";


type LiveView = Extract<OrdersView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function isOrdersView(value: unknown): value is OrdersView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function ordersCacheOrg(data: OrdersView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistOrdersSnapshot(orgHint: string, seasonHint: string, data: OrdersView): Promise<void> {
  const cacheOrg = ordersCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "live" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("orders", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("orders", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Orders already painted; IndexedDB is best-effort.
  }
}

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
  // A date alone, an ISO time, or Postgres's text form ("2026-09-24 22:00:07.39-04"), which the
  // browser cannot parse and which used to show up raw on every order line.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso}T00:00:00`
    : iso.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(normalized);
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
        <p>Approve, then pay on the vendor site. Lines come from real purchases only.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
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

  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<OrdersView | null>(null);
  viewRef.current = view;

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? orgIdProp ?? null;

  const load = useCallback(
    (seasonOverride?: number) => {
      void (async () => {
        const params = new URLSearchParams(window.location.search);
        const urlOrg = (orgIdProp ?? params.get("orgId"))?.trim() ?? "";
        const orderId = params.get("orderId");
        const seasonQuery =
          seasonOverride ??
          seasonYear ??
          (params.get("season") ? Number(params.get("season")) : null);
        const seasonHint =
          seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
        let hadCache = Boolean(viewRef.current);
        try {
          const cached = await getFeatureSnapshot<OrdersView>("orders", urlOrg || "_", seasonHint);
          if (!viewRef.current && cached?.data && isOrdersView(cached.data)) {
            setView(cached.data);
            if (cached.data.status === "live") setSeason(cached.data.seasonYear);
            setFromCache(true);
            setCachedAt(cached.cachedAt);
            hadCache = true;
          }
        } catch {
          // IndexedDB missing or blocked; live fetch still runs.
        }
        setError("");
        setErrorStatus(null);
        const query = new URLSearchParams();
        if (urlOrg) query.set("orgId", urlOrg);
        if (orderId) query.set("orderId", orderId);
        if (seasonHint) query.set("season", seasonHint);
        try {
          const response = await fetch(`/api/orders${query.toString() ? `?${query.toString()}` : ""}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          });
          const data = (await response.json()) as OrdersView & { error?: string };
          if (!response.ok || !isOrdersView(data)) {
            if (hadCache || viewRef.current) {
              setFromCache(true);
              setError("Could not refresh Orders. Showing the last copy on this device.");
              setErrorStatus(null);
            } else {
              setError("error" in data && data.error ? data.error : "Could not load the buy sheet");
              setErrorStatus(response.status);
            }
            return;
          }
          setView(data);
          if (data.status === "live") setSeason(data.seasonYear);
          setFromCache(false);
          setCachedAt(null);
          await persistOrdersSnapshot(urlOrg, seasonHint, data);
        } catch {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Orders. Showing the last copy on this device.");
            setErrorStatus(null);
          } else {
            setError("Network error — please try again.");
          }
        }
      })();
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data = (await response.json()) as OrdersView & { error?: string };
          if (!response.ok || !isOrdersView(data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          if (data.status === "live") setSeason(data.seasonYear);
          void persistOrdersSnapshot(orgId, season != null ? String(season) : "", data);
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
      <OfflineBanner feature="Orders" fromCache={fromCache} cachedAt={cachedAt} />
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
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
                {copy.showRetry ? (
                  <Button variant="secondary" type="button" onClick={() => load()}>
                    Retry
                  </Button>
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
            badge="Needs setup"
            badgeTone="setup"
            title={view.message}
            description="Choose your team, then log what, why, when, and cost. The sheet stays empty until someone adds a real line."
          >
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
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
          {/* What needs doing comes first. The "What / Why / When / Cost" card only explained the
              form's columns, and inside Business the five count tiles repeated its overview. */}
          <OrdersNextActions actions={nextActions} />
          {!embedded && live!.orders.length > 0 ? <MetricsPanel view={live!} /> : null}
          {live!.orders.length === 0 ? (
            <EmptyState
              soft
              title="Buy sheet is empty"
              description="Add what the team bought or needs: what, why, when, and the cost. Totals stay blank until someone logs a real estimate."
            />
          ) : null}
          {live!.financeAiEnabled && live!.aiSummary ? <AiSummaryPanel summary={live!.aiSummary} /> : null}
          {live!.isAdmin && live!.metrics.pending > 0 ? (
            <p className="orders-info" role="status">
              {live!.metrics.pending} line{live!.metrics.pending === 1 ? "" : "s"} awaiting your approval before a
              buy link is unlocked.
            </p>
          ) : null}
          {/* One button to log a purchase; the form was a full page section between the numbers and
              the lines that needed approving. Open straight away on an empty sheet. */}
          <details className="orders-add" open={live!.orders.length === 0 || undefined}>
            <summary className="app-button primary is-primary">Add a purchase</summary>
            <SubmitForm
              orgId={live!.orgId}
              seasonYear={season ?? live!.seasonYear}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onCreated={() => load()}
            />
          </details>
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
        description="What we bought, why, when, and what it cost. Mentors approve, then pay on the vendor site. Vantage never stores card details."
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
      <p className="orders-metrics-note">Counts and open $ come from submitted lines only.</p>
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
        Local Season Costs opt-in — separate from finance in Ask AI under Team → AI governance.
      </small>
    </section>
  );
}

function OrdersList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const pending = view.orders.filter((o) => o.status === "pending");
  const active = view.orders.filter((o) => o.status !== "pending" && o.status !== "rejected" && o.status !== "received");
  // Done and turned-down lines are history: five rejected test lines, each fully expanded, made
  // the page 3,400px long below the lines that still needed someone.
  const closed = view.orders.filter((o) => o.status === "rejected" || o.status === "received");

  return (
    <>
      {/* An empty "Needs approval" card took a screen's height to say nothing; mentors see it when a
          line is waiting. */}
      {pending.length === 0 ? (
        view.isAdmin ? <p className="orders-quiet">Nothing waiting for approval.</p> : null
      ) : (
      <section className="soft-panel">
        <h2>
          Needs approval{pending.length ? ` (${pending.length})` : ""}
        </h2>
        {pending.length ? (
          <p className="orders-section-lead">A mentor approves a line, which unlocks its buy link.</p>
        ) : null}
        {pending.length === 0 ? (
          <p className="app-muted">Nothing waiting on a mentor.</p>
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
      )}

      <section className="soft-panel">
        <h2>
          To buy and on the way{active.length ? ` (${active.length})` : ""}
        </h2>
        {active.length ? (
          <p className="orders-section-lead">Buy it on the vendor&rsquo;s site, then mark it ordered and received.</p>
        ) : null}
        {active.length === 0 ? (
          <p className="app-muted">Approved lines appear here until they arrive.</p>
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
        <details className="soft-panel orders-history">
          <summary>
            <h2>History ({closed.length})</h2>
            <span className="app-muted">Received and turned-down lines</span>
          </summary>
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
        </details>
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
  const [confirmReject, setConfirmReject] = useState(false);

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
              {member.name} ({formatInviteRole(member.role) ?? member.role})
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
        {/* Rejecting can't be taken back here, so it asks once, in place. */}
        {confirmReject ? (
          <>
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
              Yes, reject it
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmReject(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="danger" disabled={busy} onClick={() => setConfirmReject(true)}>
            Reject
          </button>
        )}
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
