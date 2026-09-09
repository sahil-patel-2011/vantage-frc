"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BusinessRelated } from "../../components/business-related";
import { Badge, EmptyState, StatTile } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import {
  MONEY_SOURCE_LABELS,
  type FinanceBalanceView,
  type UnifiedLedgerEntry,
} from "../../lib/finance/balance";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
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
import { describeBudgetLine, type BudgetLine, type BudgetVsActualView } from "../../lib/finance/budget-vs-actual";
import { formatSponsorUsd, sponsorPageTotals } from "../../lib/sponsors/totals";
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
  // Kept apart from mutation errors so an expired session offers sign-in, not a Retry that cannot work.
  const [loadFailure, setLoadFailure] = useState<{ status: number | null; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [sponsorLines, setSponsorLines] = useState<Array<{ id: string; name: string; amountUsd: number }>>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);

  const load = useCallback(async () => {
    setError("");
    setLoadFailure(null);
    const query = new URLSearchParams({ orgId, season: String(seasonYear) });
    try {
      const response = await fetch(`/api/business/finance?${query.toString()}`);
      const data = (await response.json()) as SeasonFinanceView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setLoadFailure({
          status: response.status,
          message: ("error" in data && data.error) || "Could not load season finance",
        });
        return;
      }
      setLoadFailure(null);
      setView(data);
      try {
        const [sponsorsRes, contribRes, budgetRes] = await Promise.all([
          fetch(`/api/sponsors?orgId=${encodeURIComponent(orgId)}`),
          fetch(`/api/sponsors/contributions?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`),
          fetch(`/api/finance/budget-vs-actual?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`),
        ]);
        const sponsorsData = sponsorsRes.ok ? await sponsorsRes.json() : { sponsors: [] };
        const contribData = contribRes.ok ? await contribRes.json() : { contributions: [] };
        const sponsors = Array.isArray(sponsorsData.sponsors) ? sponsorsData.sponsors : [];
        const contributions = Array.isArray(contribData.contributions) ? contribData.contributions : [];
        const totals = sponsorPageTotals(sponsors, contributions, true);
        setSponsorLines(
          sponsors
            .map((row: { id?: string; name?: string }) => ({
              id: String(row.id ?? ""),
              name: String(row.name ?? "").trim() || String(row.id ?? ""),
              amountUsd: totals.amountBySponsorId[String(row.id ?? "")] ?? 0,
            }))
            .filter((row: { id: string }) => row.id)
            .sort((a: { amountUsd: number }, b: { amountUsd: number }) => b.amountUsd - a.amountUsd),
        );
        const budgetData = (budgetRes.ok ? await budgetRes.json() : null) as BudgetVsActualView | null;
        setBudgetLines(budgetData?.status === "ready" ? budgetData.lines : []);
      } catch {
        setSponsorLines([]);
        setBudgetLines([]);
      }
    } catch (cause) {
      setLoadFailure({
        status: null,
        message: cause instanceof Error ? cause.message : "Could not load season finance",
      });
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

      {!view && !loadFailure ? <p className="app-muted">Loading season finance…</p> : null}

      {!view && loadFailure
        ? (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({
                status: loadFailure.status,
                message: loadFailure.message,
                online: typeof navigator === "undefined" ? true : navigator.onLine,
              }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message: loadFailure.message,
              },
            );
            return (
              <EmptyState title={copy.title} description={copy.description}>
                <div className="season-finance-next">
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button secondary" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </EmptyState>
            );
          })()
        : null}

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

      {live ? (
        <LiveDesk
          view={live}
          busy={busy}
          mutate={mutate}
          onFunding={submitFunding}
          onPurchase={submitPurchase}
          sponsorLines={sponsorLines}
          budgetLines={budgetLines}
        />
      ) : null}
    </div>
  );
}

function LiveDesk({
  view,
  busy,
  mutate,
  onFunding,
  onPurchase,
  sponsorLines,
  budgetLines,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
  onFunding: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPurchase: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  sponsorLines: Array<{ id: string; name: string; amountUsd: number }>;
  budgetLines: BudgetLine[];
}) {
  const { rollup } = view;
  const hasPlan = rollup.plannedIncomeCents > 0 || rollup.plannedSpendCents > 0 || view.funding.length > 0;
  return (
    <>
      <BalancePanel orgId={view.orgId} />

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
            Fundraisers.
          </p>
          <div style={{ marginTop: 16 }}>
            <span className="biz-overline">Per-sponsor recorded contributions</span>
            {sponsorLines.length === 0 ? (
              <p className="app-muted">No recorded sponsor contributions this season.</p>
            ) : (
              <ul className="season-finance-elsewhere">
                {sponsorLines.map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <strong>{formatSponsorUsd(row.amountUsd)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {budgetLines.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <span className="biz-overline">Budget vs recorded spend</span>
                <ul className="season-finance-elsewhere">
                  {budgetLines.map((line) => (
                    <li key={line.categoryId ?? line.name}>
                      <span>{line.name}</span>
                      <strong>{describeBudgetLine(line)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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

/** CSV columns for the unified ledger export — raw values, never formatted. */
const LEDGER_CSV_COLUMNS: readonly CsvColumn<UnifiedLedgerEntry>[] = [
  { key: "date", header: "date", value: (row) => row.date.slice(0, 10), hint: "When the money moved" },
  { key: "label", header: "entry", hint: "What the row records" },
  {
    key: "source",
    header: "source",
    value: (row) => MONEY_SOURCE_LABELS[row.source] ?? row.source,
    hint: "Which surface recorded it (Order, Receipt, Season cost, Manual…)",
  },
  { key: "direction", header: "direction", hint: "in = income, out = spend" },
  { key: "amountUsd", header: "amount_usd", hint: "US dollars, positive numbers" },
  {
    key: "category",
    header: "category",
    value: (row) => row.categoryName ?? "",
    hint: "Budget category, when one is assigned",
  },
  {
    key: "mirrored",
    header: "on_unified_ledger",
    hint: "false = legacy row not yet mirrored onto the unified ledger",
  },
];

/**
 * Real money balance — totals derived on every load from recorded rows only
 * (the unified ledger from 0461_money_unify.sql, plus sponsor cash,
 * fundraisers, funding desk, and grants). No stored balance column exists
 * anywhere, and rows already mirrored onto the ledger are never counted twice.
 */
function BalancePanel({ orgId }: { orgId: string }) {
  const [balance, setBalance] = useState<FinanceBalanceView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/finance/balance?${new URLSearchParams({ orgId }).toString()}`);
        const data = (await response.json()) as FinanceBalanceView | { error?: string };
        if (cancelled) return;
        if (!response.ok || !("status" in data)) {
          setFailed(true);
          return;
        }
        setBalance(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // usdToBalance: API returns USD numbers; reuse the file's cents formatter.
  const usd = (amount: number) => money(Math.round(amount * 100));

  return (
    <section className="app-card finance-balance" aria-label="Team money balance">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Balance</span>
          <h2>Where the money actually stands</h2>
          <p className="app-muted finance-balance-note">
            Derived from recorded income and spend only — ledger, sponsor cash, fundraisers, funding lines,
            grants, orders, receipts, and paid season costs. Nothing is estimated.
          </p>
        </div>
      </header>

      {failed ? (
        <p className="app-muted">Balance could not load right now. The season figures below are unaffected.</p>
      ) : null}
      {!failed && !balance ? <p className="app-muted">Computing balance…</p> : null}
      {balance?.status === "setup_required" ? <p className="app-muted">{balance.message}</p> : null}

      {balance?.status === "live" && !balance.hasData ? (
        <p className="app-muted">
          No money recorded yet. Log a funding source, sponsor contribution, or purchase and the balance
          appears here — never a placeholder number.
        </p>
      ) : null}

      {balance?.status === "live" && balance.hasData ? (
        <>
          <div className="finance-balance-tiles">
            <StatTile label="Money in" value={usd(balance.totalInUsd)} />
            <StatTile label="Money out" value={usd(balance.totalOutUsd)} />
            <StatTile
              label="Balance"
              value={usd(balance.balanceUsd)}
              className={balance.balanceUsd < 0 ? "finance-balance-negative" : undefined}
              footer={balance.balanceUsd < 0 ? "Spend exceeds recorded income" : "Recorded income minus spend"}
            />
          </div>

          {balance.byCategory.length ? (
            <div className="finance-balance-activity">
              <h3>By category</h3>
              <ul>
                {balance.byCategory.map((row) => (
                  <li key={row.categoryId ?? "uncategorized"}>
                    <span className="finance-balance-activity-label">
                      <strong>{row.name}</strong>
                      {row.inUsd > 0 ? <small>+{usd(row.inUsd)} in</small> : null}
                    </span>
                    <span className={`finance-balance-amount ${row.outUsd > 0 ? "out" : "in"}`}>
                      {row.outUsd > 0 ? `−${usd(row.outUsd)}` : `+${usd(row.inUsd)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {balance.ledger.length ? (
            <div className="finance-balance-activity">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h3 style={{ margin: 0 }}>The ledger</h3>
                <ExportButton
                  rows={balance.ledger}
                  columns={LEDGER_CSV_COLUMNS}
                  feature="Money ledger"
                  orgId={orgId}
                  size="sm"
                  provenance="Every recorded money movement on the unified ledger, newest first — mirrored orders, receipts, season costs, and manual entries, deduplicated by source."
                />
              </div>
              <div className="biz-table-wrap">
                <table className="biz-table">
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Source</th>
                      <th>Category</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.ledger.map((row) => (
                      <tr key={`${row.source}-${row.id}`}>
                        <td>
                          <strong>{row.label}</strong>
                          <small>{row.date.slice(0, 10)}</small>
                        </td>
                        <td>
                          <Badge tone="neutral" icon={null}>
                            {MONEY_SOURCE_LABELS[row.source] ?? row.source}
                          </Badge>
                          {!row.mirrored ? (
                            <Badge tone="info" icon={null} title="This legacy row is not yet mirrored onto the unified ledger; it is still counted exactly once.">
                              legacy
                            </Badge>
                          ) : null}
                        </td>
                        <td>{row.categoryName ?? "Uncategorized"}</td>
                        <td>
                          <span className={`finance-balance-amount ${row.direction}`}>
                            {row.direction === "in" ? "+" : "−"}
                            {usd(row.amountUsd)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="app-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Sponsor cash, fundraiser proceeds, funding lines, and grant awards are counted from their own
                surfaces (see “Also recorded elsewhere”) so no dollar appears twice.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
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
