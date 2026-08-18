"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState } from "../../components/ui";
import { SEASON_FINANCE_RELATED_INCLUDE } from "../../lib/business/business-related";
import {
  FUNDING_KIND_LABELS,
  FUNDING_KINDS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type SeasonFinanceView,
} from "../../lib/business/compute-season-finance";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./season-finance.css";

type LiveView = Extract<SeasonFinanceView, { status: "live" }>;

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    cents / 100,
  );
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SeasonFinanceClient({
  orgId,
  seasonYear,
  embedded = false,
}: {
  orgId: string;
  seasonYear: number;
  embedded?: boolean;
}) {
  const [view, setView] = useState<SeasonFinanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    const query = new URLSearchParams({ orgId, season: String(seasonYear) });
    try {
      const response = await fetch(`/api/business/finance?${query.toString()}`);
      const data = (await response.json()) as SeasonFinanceView | { error?: string };
      if (!response.ok || !("status" in data)) {
        throw new Error("error" in data && data.error ? data.error : "Could not load season finance");
      }
      setView(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load season finance");
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/business/finance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear, ...payload }),
        });
        const data = (await response.json()) as SeasonFinanceView | { error?: string };
        if (!response.ok || !("status" in data)) {
          throw new Error("error" in data && data.error ? data.error : "Could not save");
        }
        setView(data);
        setNotice("Saved.");
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, orgId, seasonYear],
  );

  const live = view?.status === "live" ? view : null;

  async function submitFunding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await mutate({
      action: "add-funding",
      kind: data.get("kind"),
      name: data.get("name"),
      plannedDollars: data.get("plannedDollars"),
      receivedDollars: data.get("receivedDollars"),
      receivedOn: data.get("receivedOn"),
      notes: data.get("notes"),
    });
    if (ok) form.reset();
  }

  async function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await mutate({
      action: "add-purchase",
      purchasedOn: data.get("purchasedOn"),
      vendor: data.get("vendor"),
      item: data.get("item"),
      categoryId: data.get("categoryId"),
      amountDollars: data.get("amountDollars"),
      paymentMethod: data.get("paymentMethod"),
      receiptUrl: data.get("receiptUrl"),
      notes: data.get("notes"),
    });
    if (ok) form.reset();
  }

  return (
    <div className={`biz-stack season-finance${embedded ? " embedded" : ""}`}>
      <BusinessRelated
        orgId={orgId}
        active="finance"
        include={SEASON_FINANCE_RELATED_INCLUDE}
        ariaLabel="Related season finance tools"
      />

      {error ? (
        <div className="biz-alert danger" role="alert">
          <strong>Couldn’t complete that.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="biz-alert success" role="status">
          <strong>Done.</strong>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      ) : null}

      {!view && !error ? <p className="app-muted">Loading season finance…</p> : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message} description="Funding, purchases, and sponsorships stay empty until this workspace can read the finance tables.">
          <div className="season-finance-next">
            {view.steps.map((step) => (
              <a key={step.id} className="app-button secondary" href={step.href}>
                {step.label}
              </a>
            ))}
          </div>
        </EmptyState>
      ) : null}

      {live ? <LiveDesk view={live} busy={busy} mutate={mutate} onFunding={submitFunding} onPurchase={submitPurchase} /> : null}
    </div>
  );
}

function LiveDesk({
  view,
  busy,
  mutate,
  onFunding,
  onPurchase,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
  onFunding: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPurchase: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const { rollup } = view;
  const hasPlan = rollup.plannedIncomeCents > 0 || rollup.plannedSpendCents > 0 || view.funding.length > 0;
  return (
    <>
      <section className="season-finance-next app-card soft-panel" aria-label="Next actions">
        <header>
          <span className="biz-overline">Plan this season</span>
          <h2>What to log next</h2>
        </header>
        <ul>
          {view.nextActions.map((action) => (
            <li key={action.id}>
              <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
                {action.label}
              </a>
              <span>{action.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="biz-kpis" aria-label="Season cash plan">
        <Kpi label="Planned income" value={hasPlan ? money(rollup.plannedIncomeCents) : "—"} detail="Funding lines, or fundraising goals if none yet" />
        <Kpi label="Received" value={money(rollup.receivedIncomeCents)} detail={`${money(rollup.fundingReceivedCents)} on this desk + CRM / grants / fundraisers`} tone="good" />
        <Kpi
          label="Still to raise"
          value={rollup.plannedSpendCents > 0 ? money(rollup.remainingToRaiseCents) : "—"}
          detail="Planned spend minus received cash — blank until a budget exists"
          tone={rollup.remainingToRaiseCents > 0 ? "warn" : "neutral"}
        />
        <Kpi label="Planned spend" value={rollup.plannedSpendCents > 0 ? money(rollup.plannedSpendCents) : "—"} detail="Category allocations or operating budget" />
        <Kpi label="Spent" value={money(rollup.actualSpendCents)} detail={`${money(rollup.purchaseLogCents)} receipts + orders + season costs`} />
        <Kpi
          label="Cash position"
          value={money(rollup.cashPositionCents)}
          detail="Received minus spent from logged rows only"
          tone={rollup.cashPositionCents < 0 ? "danger" : "blue"}
        />
      </section>

      <section className="biz-grid two">
        <article className="app-card">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Also recorded elsewhere</span>
              <h2>Do not re-enter these deposits</h2>
            </div>
          </header>
          <ul className="season-finance-elsewhere">
            <li>
              <span>Sponsor cash</span>
              <strong>{money(rollup.sponsorCashCents)}</strong>
              <a href={hubHref("/business", "sponsors", view.orgId)}>Sponsors</a>
            </li>
            <li>
              <span>In-kind / discounts</span>
              <strong>{money(rollup.sponsorInKindCents)}</strong>
              <a href={hubHref("/business", "sponsorship", view.orgId)}>Sponsorship</a>
            </li>
            <li>
              <span>Grant awards</span>
              <strong>{money(rollup.grantAwardedCents)}</strong>
              <a href={hubHref("/business", "grants", view.orgId)}>Grants</a>
            </li>
            <li>
              <span>Fundraiser proceeds</span>
              <strong>{money(rollup.fundraiserProceedsCents)}</strong>
              <a href={withOrgHref("/fundraisers", view.orgId)}>Fundraisers</a>
            </li>
            <li>
              <span>Open purchase requests</span>
              <strong>{money(rollup.poRequestedCents)}</strong>
              <a href={hubHref("/business", "orders", view.orgId)}>Orders</a>
            </li>
            <li>
              <span>Paid season costs</span>
              <strong>{money(rollup.seasonCostsPaidCents)}</strong>
              <a href={withOrgHref("/costs", view.orgId)}>Season Costs</a>
            </li>
          </ul>
          <p className="app-muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
            Use funding lines for school funds, student fees, and deposits that are not already in Sponsors, Grants, or
            Fundraisers. Totals never invent DEMO dollars.
          </p>
        </article>
        <article className="app-card">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Funding sources</span>
              <h2>School, fees, grants, sponsors, fundraisers</h2>
            </div>
            <span className="biz-count">{view.funding.length}</span>
          </header>
          {view.canManageFinance ? (
            <form className="biz-form-grid" onSubmit={(event) => void onFunding(event)}>
              <label className="biz-field">
                <span>Kind</span>
                <select name="kind" defaultValue="school" required>
                  {FUNDING_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {FUNDING_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="biz-field">
                <span>Name</span>
                <input name="name" required placeholder="District allocation, dues, NASA grant…" />
              </label>
              <label className="biz-field">
                <span>Planned</span>
                <input name="plannedDollars" type="number" min="0" step="0.01" defaultValue="0" required />
              </label>
              <label className="biz-field">
                <span>Received</span>
                <input name="receivedDollars" type="number" min="0" step="0.01" defaultValue="0" required />
              </label>
              <label className="biz-field">
                <span>Received on</span>
                <input name="receivedOn" type="date" />
              </label>
              <label className="biz-field wide">
                <span>Notes</span>
                <input name="notes" placeholder="Check #, board vote, restrictions…" />
              </label>
              <button className="app-button" disabled={busy}>
                Add funding source
              </button>
            </form>
          ) : (
            <p className="app-muted">Finance leads add school funds and other income. Members can still log receipts.</p>
          )}
          <div className="biz-table-wrap">
            <table className="biz-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Planned</th>
                  <th>Received</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.funding.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>
                        {FUNDING_KIND_LABELS[row.kind]}
                        {row.receivedOn ? ` · ${row.receivedOn}` : ""}
                      </small>
                    </td>
                    <td>{money(row.plannedCents)}</td>
                    <td>{money(row.receivedCents)}</td>
                    <td>
                      {view.canManageFinance ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          onClick={() => void mutate({ action: "delete-funding", fundingId: row.id })}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!view.funding.length ? (
                  <tr>
                    <td colSpan={4}>No funding sources yet. School funds, dues, and one-off deposits belong here.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Purchase log</span>
            <h2>Receipts, reimbursements, and cash buys</h2>
            <p className="app-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              Amazon / buy-link approvals stay on{" "}
              <a href={hubHref("/business", "orders", view.orgId)}>Orders</a>. Open reimbursements:{" "}
              {money(rollup.reimbursementOpenCents)}.
            </p>
          </div>
          <span className="biz-count">{view.purchases.length}</span>
        </header>
        <form className="biz-form-grid" onSubmit={(event) => void onPurchase(event)}>
          <label className="biz-field">
            <span>Date</span>
            <input name="purchasedOn" type="date" defaultValue={today()} required />
          </label>
          <label className="biz-field">
            <span>Vendor</span>
            <input name="vendor" required placeholder="McMaster, Home Depot, Amazon…" />
          </label>
          <label className="biz-field wide">
            <span>What you bought</span>
            <input name="item" required placeholder="M3 hardware, hotel deposit, field tape…" />
          </label>
          <label className="biz-field">
            <span>Category</span>
            <select name="categoryId" defaultValue="">
              <option value="">Uncategorized</option>
              {view.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} ({dollars(category.allocatedCents)})
                </option>
              ))}
            </select>
          </label>
          <label className="biz-field">
            <span>Amount</span>
            <input name="amountDollars" type="number" min="0" step="0.01" required />
          </label>
          <label className="biz-field">
            <span>How it was paid</span>
            <select name="paymentMethod" defaultValue="card">
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </label>
          <label className="biz-field">
            <span>Receipt link</span>
            <input name="receiptUrl" type="url" placeholder="https://…" />
          </label>
          <label className="biz-field wide">
            <span>Notes</span>
            <input name="notes" placeholder="Who paid, PO number, restriction…" />
          </label>
          <button className="app-button" disabled={busy}>
            Log purchase
          </button>
        </form>
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>Purchase</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Paid</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.purchases.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.item}</strong>
                    <small>
                      {row.vendor} · {row.purchasedOn} · {row.loggedByName}
                    </small>
                    {row.receiptUrl ? (
                      <a href={row.receiptUrl} target="_blank" rel="noreferrer">
                        Receipt ↗
                      </a>
                    ) : null}
                  </td>
                  <td>{row.categoryName ?? "Uncategorized"}</td>
                  <td>
                    <strong>{money(row.amountCents)}</strong>
                  </td>
                  <td>
                    {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                    {row.paymentMethod === "reimbursement" && !row.reimbursedOn ? " · open" : ""}
                    {row.reimbursedOn ? ` · repaid ${row.reimbursedOn}` : ""}
                  </td>
                  <td>
                    <div className="biz-row-actions">
                      {row.paymentMethod === "reimbursement" && !row.reimbursedOn && view.canManageFinance ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void mutate({ action: "mark-reimbursed", purchaseId: row.id, reimbursedOn: today() })}
                        >
                          Mark repaid
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() => void mutate({ action: "delete-purchase", purchaseId: row.id })}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!view.purchases.length ? (
                <tr>
                  <td colSpan={5}>No receipts yet. Log hardware, travel, and reimbursements here — never placeholder spend.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn" | "danger" | "neutral" | "blue";
}) {
  return (
    <article className={`biz-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
