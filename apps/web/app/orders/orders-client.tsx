"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { EmptyState } from "../../components/ui/empty-state";
import { PageHeader } from "../../components/ui/page-header";
import { showBuyPanel, statusLabel } from "../../lib/orders/evaluate";
import type { OrdersView } from "../../lib/orders/compute-orders";
import type { OrderRequest } from "../../lib/orders/types";

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

export default function OrdersClient({ embedded = false, seasonYear, orgId: orgIdProp }: OrdersClientProps = {}) {
  const [view, setView] = useState<OrdersView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(seasonYear ?? null);

  const orgId = (view && "orgId" in view ? view.orgId : null) ?? orgIdProp ?? null;

  const load = useCallback(
    (seasonOverride?: number) => {
      setError("");
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
            setError("error" in data && data.error ? data.error : "Could not load orders");
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
  const orgQ = live ? `?orgId=${encodeURIComponent(live.orgId)}` : "";
  const seasonOptions = useMemo(() => {
    const year = live?.seasonYear ?? season ?? new Date().getFullYear();
    return [year - 1, year, year + 1];
  }, [live?.seasonYear, season]);

  const body = (
    <>
      {error ? (
        <p className="orders-error" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        <EmptyState soft title="Opening orders…" description="Loading this season’s purchase requests." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title={view.message}
          description="Choose a workspace, then return here to submit and approve purchases."
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
      ) : (
        <>
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
          <MetricsPanel view={live!} />
          {live!.orders.length === 0 ? (
            <EmptyState
              soft
              title="No purchase requests yet"
              description="Submit what the team needs below. Mentors approve here, then the buyer opens the vendor link and pays outside Vantage — card and bank details are never stored."
            />
          ) : null}
          {live!.financeAiEnabled && live!.aiSummary ? <AiSummaryPanel summary={live!.aiSummary} /> : null}
          {live!.metrics.mineToBuy > 0 ? (
            <p className="orders-warn" role="status">
              {live!.metrics.mineToBuy} approved request{live!.metrics.mineToBuy === 1 ? "" : "s"} waiting on you to
              order.
            </p>
          ) : null}
          <SubmitForm busy={busy} mutate={mutate} />
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
        title="Purchase requests"
        description="Tell mentors what the team needs, get approval, then buy on the vendor site. Vantage never stores card or bank details."
      >
        {live ? (
          <nav className="orders-links" aria-label="Related business tools">
            <a
              className="app-button secondary"
              href={
                live.orgId
                  ? `/business?orgId=${encodeURIComponent(live.orgId)}&tab=orders`
                  : "/business?tab=orders"
              }
            >
              Business · Orders
            </a>
            <a
              className="app-button secondary"
              href={
                live.orgId
                  ? `/business?orgId=${encodeURIComponent(live.orgId)}&tab=budget`
                  : "/business?tab=budget"
              }
            >
              Budget
            </a>
            <a className="app-button secondary" href={`/costs${orgQ}`}>
              Season costs
            </a>
          </nav>
        ) : null}
      </PageHeader>
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
    { label: "Open total", value: usd(m.openTotalUsd) },
  ];
  return (
    <section className="soft-panel">
      <h2>At a glance</h2>
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

function SubmitForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    mutate({ action: "submit-order", ...data });
    form.reset();
  };

  return (
    <section className="soft-panel">
      <h2>Submit a need</h2>
      <form className="orders-form" onSubmit={onSubmit}>
        <label>
          What do you need?
          <input name="title" required maxLength={200} placeholder='e.g. 1/2" hex shaft stock' />
        </label>
        <label>
          Why does the team need it?
          <textarea
            name="justification"
            required
            maxLength={2000}
            placeholder="Subsystem, event deadline, or pit spare rationale — never paste card or bank numbers"
          />
        </label>
        <div className="orders-form-grid">
          <label>
            Estimate ($)
            <input name="estimateUsd" type="number" min={0} step="0.01" required placeholder="42.00" />
          </label>
          <label>
            Vendor <small>optional</small>
            <input name="vendor" maxLength={120} placeholder="Amazon, McMaster, VEX…" />
          </label>
          <label>
            Product URL <small>optional</small>
            <input name="itemUrl" type="url" placeholder="https://…" />
          </label>
        </div>
        <button type="submit" className="orders-submit" disabled={busy}>
          Submit for approval
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
        <h2>Awaiting approval</h2>
        {pending.length === 0 ? (
          <p className="app-muted">No requests waiting on mentors.</p>
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
        <h2>In progress &amp; done</h2>
        {active.length === 0 ? (
          <p className="app-muted">Approved and fulfilled requests appear here.</p>
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
      {order.justification ? <p className="app-muted">{order.justification}</p> : null}
      <div className="orders-meta">
        <span>{usd(order.totalCostUsd)}</span>
        <span>{order.vendor}</span>
        <span>Requested by {order.requestedByName ?? "team member"}</span>
        {order.buyerName ? <span>Buyer: {order.buyerName}</span> : null}
        {order.reviewNotes ? <span>Note: {order.reviewNotes}</span> : null}
      </div>

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
      <h3>Ordering checklist</h3>
      <ol>
        <li>Open the vendor product page and confirm part number and quantity.</li>
        <li>Pay on the vendor site with the team card — never enter card or bank details in Vantage.</li>
        <li>Save the receipt for finance / reimbursement.</li>
        <li>Return here and mark the request ordered, then received when it arrives.</li>
      </ol>
      {order.itemUrl ? (
        <a href={order.itemUrl} target="_blank" rel="noopener noreferrer">
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
            aria-label="Product URL"
          />
          <button type="submit" disabled={busy || !itemUrl.trim()}>
            Save buy link
          </button>
        </form>
      ) : (
        <span className="app-muted">No product URL on file — ask an admin or buyer to add one.</span>
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
        Approve
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
