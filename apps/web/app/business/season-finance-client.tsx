"use client";

import { staleCopyNotice, staleCopyProps } from "../../lib/ui/stale-copy";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, EmptyState, StatTile, Button, askConfirm, StatRowSkeleton, TextBlockSkeleton } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { OfflineBanner } from "../../components/offline-banner";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  MONEY_SOURCE_LABELS,
  type FinanceBalanceView,
  type UnifiedLedgerEntry,
} from "../../lib/finance/balance";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  FUNDING_KIND_LABELS,
  FUNDING_KINDS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type SeasonFinanceView,
} from "../../lib/business/compute-season-finance";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { describeBudgetLine, type BudgetLine } from "../../lib/finance/budget-vs-actual";
import { formatSponsorUsd } from "../../lib/sponsors/totals";
import { FINANCE_MANAGER_REQUIRED } from "../../lib/finance/finance-managers";
import { loadMoneyExtras, readBalance, type BalanceRead, type SponsorLine } from "./season-finance-reads";
import "./season-finance.css";

type LiveView = Extract<SeasonFinanceView, { status: "live" }>;

function isSeasonFinanceView(value: unknown): value is SeasonFinanceView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "live" || status === "setup_required";
}

async function persistSeasonFinanceSnapshot(
  orgId: string,
  seasonYear: number,
  data: SeasonFinanceView,
): Promise<void> {
  if (!orgId) return;
  try {
    await putFeatureSnapshot("season-finance", orgId, data, String(seasonYear));
  } catch {
    // Live Money already painted; IndexedDB is best-effort.
  }
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...wholeOrCents(cents) }).format(
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
  const [sponsorLines, setSponsorLines] = useState<SponsorLine[]>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewHold = useRef<SeasonFinanceView | null>(null);
  viewHold.current = view;
  // The balance card's first read starts with the season view, not after it renders.
  const [balancePrefetch, setBalancePrefetch] = useState<Promise<BalanceRead> | null>(null);
  const balancePrefetchStarted = useRef(false);

  const load = useCallback(async () => {
    let hadCache = Boolean(viewHold.current);
    // Started now, read once the season view is in: one round trip instead of two in a row.
    const extras = orgId ? loadMoneyExtras(orgId, seasonYear) : null;
    if (orgId && !balancePrefetchStarted.current) {
      balancePrefetchStarted.current = true;
      setBalancePrefetch(
        readBalance(orgId)
          .then((data) => ({ orgId, data }))
          .catch(() => ({ orgId, data: null })),
      );
    }
    try {
      const cached = await getFeatureSnapshot<SeasonFinanceView>(
        "season-finance",
        orgId || "_",
        String(seasonYear),
      );
      if (!viewHold.current && cached?.data && isSeasonFinanceView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setError("");
    setLoadFailure(null);
    const query = new URLSearchParams({ orgId, season: String(seasonYear) });
    try {
      const response = await fetch(`/api/business/finance?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as SeasonFinanceView | { error?: string };
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setLoadFailure({
          status: response.status,
          message: ("error" in data && data.error) || "Choose your team",
        });
        return;
      }
      if (!response.ok || !isSeasonFinanceView(data)) {
        if (hadCache || viewHold.current) {
          setFromCache(true);
          setError(staleCopyNotice("Money"));
          setLoadFailure(null);
        } else {
          setLoadFailure({
            status: response.status,
            message: ("error" in data && data.error) || "Could not load season finance",
          });
        }
        return;
      }
      setLoadFailure(null);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSeasonFinanceSnapshot(orgId, seasonYear, data);
      const extra = extras ? await extras : { sponsorLines: [], budgetLines: [] };
      setSponsorLines(extra.sponsorLines);
      setBudgetLines(extra.budgetLines);
    } catch (cause) {
      if (hadCache || viewHold.current) {
        setFromCache(true);
        setError(staleCopyNotice("Money"));
        setLoadFailure(null);
      } else {
        setLoadFailure({
          status: null,
          message: cause instanceof Error ? cause.message : "Could not load season finance",
        });
      }
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  // "What to log next" links to #add-funding / #log-receipt on this page: open that form.
  const loaded = Boolean(view);
  useEffect(() => {
    if (!loaded) return;
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      if (id !== "add-funding" && id !== "log-receipt") return;
      const fold = document.getElementById(id);
      if (!(fold instanceof HTMLDetailsElement)) return;
      fold.open = true;
      fold.scrollIntoView({ block: "start" });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [loaded]);

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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as SeasonFinanceView | { error?: string };
        if (!response.ok || !isSeasonFinanceView(data)) {
          throw new Error("error" in data && data.error ? data.error : "Could not save");
        }
        setView(data);
        setNotice("Saved.");
        await persistSeasonFinanceSnapshot(orgId, seasonYear, data);
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
      <OfflineBanner feature="Money" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <div {...staleCopyProps(error, "biz-alert danger")}>
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

      {!view && !loadFailure ? (
        <div className="season-finance-loading" role="status" aria-busy="true">
          <span className="visually-hidden">Loading season finance</span>
          <StatRowSkeleton count={3} />
          <TextBlockSkeleton lines={4} />
        </div>
      ) : null}

      {!view && loadFailure && (loadFailure.status === 401 || loadFailure.status === 403) ? (
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Choose your team to open this season’s money plan."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : !view && loadFailure ? (
        (() => {
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
                    <Button as="a" variant="primary" href={copy.primary.href}>
                      {copy.primary.label}
                    </Button>
                  ) : null}
                  {copy.showRetry ? (
                    <Button variant="secondary" type="button" onClick={() => void load()}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              </EmptyState>
            );
          })()
      ) : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Needs setup" badgeTone="setup" title="Choose your team" description="Choose your team to open this season’s money plan.">
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
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
          balancePrefetch={balancePrefetch}
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
  balancePrefetch,
}: {
  balancePrefetch: Promise<BalanceRead> | null;
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
      <BalancePanel orgId={view.orgId} refreshKey={view} prefetch={balancePrefetch} />

      {/* No "What to log next" row: each of its buttons repeated the button on its own section
          ("Add money in", "Log a receipt"), and "Open purchase orders" repeated the Orders chip. */}

      {/* Three numbers a mentor asks for; six tiles repeated each other ("Planned spend" was
          the season budget, "Still to raise" the same figure again). The rest fold below. */}
      <section className="biz-kpis" aria-label="Season money">
        <Kpi label="Received" value={money(rollup.receivedIncomeCents)} detail="Sponsors, grants, fundraisers and the money added below" tone="good" />
        {/* Committed, like Season budget, Part requests and the Business overview: an approved
            $45 order counted there and not here, so the pages showed different amounts left. */}
        <Kpi label="Committed" value={money(rollup.committedSpendCents)} detail="Receipts, approved orders and paid season costs" />
        {rollup.plannedSpendCents > 0 ? (
          <Kpi
            label="Left in budget"
            value={money(rollup.plannedSpendCents - rollup.committedSpendCents)}
            detail={`Of a ${money(rollup.plannedSpendCents)} season budget`}
            tone={rollup.plannedSpendCents - rollup.committedSpendCents < 0 ? "danger" : "blue"}
          />
        ) : (
          <CashKpi rollup={rollup} />
        )}
      </section>
      <details className="season-finance-more">
        <summary data-disclosure>More numbers</summary>
        <section className="biz-kpis" aria-label="Season plan">
          <Kpi label="Planned income" value={hasPlan ? money(rollup.plannedIncomeCents) : "—"} detail="The money in below, or fundraising goals if none yet" />
          <Kpi
            label="Still to raise"
            value={rollup.plannedSpendCents > 0 ? money(rollup.remainingToRaiseCents) : "—"}
            detail={rollup.plannedSpendCents > 0 ? "Season budget minus money received" : "Set a season budget to see this"}
            tone={rollup.remainingToRaiseCents > 0 ? "warn" : "neutral"}
          />
          <CashKpi rollup={rollup} />
        </section>
      </details>

      <section className="biz-grid two">
        <details className="app-card season-finance-fold">
          <summary>
            <span className="biz-overline">Also recorded elsewhere</span>
            <h2>Money already on other pages</h2>
            <small>Sponsors, grants, fundraisers, orders and season costs. Don&apos;t enter these again here.</small>
          </summary>
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
            Add school funds, student fees and other money here. Sponsor money, grants and fundraisers are counted from
            their own pages.
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
        </details>
        <article className="app-card">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Other money in</span>
              <h2>School funds, fees and other income</h2>
            </div>
            <span className="biz-count">{view.funding.length}</span>
          </header>
          {view.canManageFinance ? (
            <details className="season-finance-add" id="add-funding">
              <summary>Add money in</summary>
            <form className="biz-form-grid" onSubmit={(event) => void onFunding(event)}>
              <label className="biz-field">
                <span>Kind</span>
                <select name="kind" defaultValue="school" required>
                  {/* Sponsor cash, grants and fundraisers have their own pages and are already
                      counted; offering them here invited entering the same money twice. */}
                  {FUNDING_KINDS.filter((kind) => kind !== "grant" && kind !== "sponsor" && kind !== "fundraiser").map((kind) => (
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
              <Button type="submit" variant="primary" disabled={busy}>
                Add funding source
              </Button>
            </form>
            </details>
          ) : (
            <p className="app-muted">{FINANCE_MANAGER_REQUIRED}</p>
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
                          onClick={async () => { if (await askConfirm({ title: "Remove this funding source?", body: `“${row.name}” comes out of this season's funding.`, confirmLabel: "Remove funding", tone: "destructive" })) void mutate({ action: "delete-funding", fundingId: row.id }); }}
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
        {/* Recording spend is a finance-manager job (0714). Everyone else asks for
            what they need on Orders, where a finance manager approves it. */}
        {view.canManageFinance ? (
        <details className="season-finance-add" id="log-receipt">
          <summary>Log a receipt</summary>
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
          <Button type="submit" variant="primary" disabled={busy}>
            Log purchase
          </Button>
        </form>
        </details>
        ) : view.role === "viewer" ? null : (
          // View only can't ask for purchases (0715), so it isn't offered the link.
          <p className="app-muted">
            Need something bought? <a href={hubHref("/business", "orders", view.orgId)}>Submit a purchase request</a>. A
            finance manager approves it and records the spend.
          </p>
        )}
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
                      {view.canManageFinance ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          onClick={async () => { if (await askConfirm({ title: "Remove this purchase?", body: `“${row.item}” comes out of this season's purchases.`, confirmLabel: "Remove purchase", tone: "destructive" })) void mutate({ action: "delete-purchase", purchaseId: row.id }); }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!view.purchases.length ? (
                <tr>
                  <td colSpan={5}>No receipts yet. Log hardware, travel, and reimbursements here.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** CSV columns for the money record export — raw values, never formatted. */
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
    hint: "No = an older entry, still counted once in the money record",
  },
];

/**
 * Real money balance — totals derived on every load from recorded rows only
 * (the money record from 0461_money_unify.sql, plus sponsor cash,
 * fundraisers, funding desk, and grants). No stored balance column exists
 * anywhere, and rows already mirrored onto the ledger are never counted twice.
 */
function BalancePanel({
  orgId,
  refreshKey,
  prefetch,
}: {
  orgId: string;
  refreshKey: LiveView;
  prefetch: Promise<BalanceRead> | null;
}) {
  const [balance, setBalance] = useState<FinanceBalanceView | null>(null);
  const [failed, setFailed] = useState(false);
  const usedPrefetch = useRef<Promise<BalanceRead> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // The last balance stays up while a refresh runs; "Computing balance…" is for the first
    // load only. A request with no time limit could leave that line under finished tiles forever.
    (async () => {
      try {
        let data: FinanceBalanceView | null = null;
        // First render: use the read started with the season view (once, same team only).
        if (prefetch && usedPrefetch.current !== prefetch) {
          usedPrefetch.current = prefetch;
          const early = await prefetch;
          if (early.orgId === orgId) data = early.data;
        }
        data ??= await readBalance(orgId);
        if (cancelled) return;
        if (!data) {
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
  }, [orgId, refreshKey, prefetch]);

  // usdToBalance: API returns USD numbers; reuse the file's cents formatter.
  const usd = (amount: number) => money(Math.round(amount * 100));

  // Nothing recorded yet: no card. "No money recorded yet" sat above tiles showing $45
  // committed, which read as a contradiction.
  if (balance?.status === "live" && !balance.hasData) return null;

  return (
    <section className="app-card finance-balance" aria-label="Team money balance">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Balance</span>
          <h2>Where the money actually stands</h2>
          <p className="app-muted finance-balance-note">
            Counted from recorded money only: money in and out, sponsor cash, fundraisers, other income,
            grants, orders, receipts, and paid season costs. Nothing is estimated.
          </p>
        </div>
      </header>

      {failed && !balance ? (
        <p className="app-muted">Balance could not load right now. The season figures below are unaffected.</p>
      ) : null}
      {!failed && !balance ? (
        <div role="status" aria-busy="true">
          <span className="visually-hidden">Computing balance</span>
          <StatRowSkeleton count={3} />
        </div>
      ) : null}
      {balance?.status === "setup_required" ? <p className="app-muted">{balance.message}</p> : null}

      {balance?.status === "live" && !balance.hasData ? (
        <p className="app-muted">
          No money recorded yet. Log a funding source, sponsor contribution, or purchase and the balance
          appears here.
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
                <h3 style={{ margin: 0 }}>Every entry</h3>
                <ExportButton
                  rows={balance.ledger}
                  columns={LEDGER_CSV_COLUMNS}
                  feature="Money in and out"
                  orgId={orgId}
                  size="sm"
                  provenance="Every recorded money movement on the money record, newest first — mirrored orders, receipts, season costs, and manual entries, counted once by source."
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
                            <Badge tone="info" icon={null} title="This legacy row is not yet mirrored onto the money record; it is still counted exactly once.">
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

/**
 * "Recorded in minus recorded out". A new team logs costs before income, and the headline read
 * "Money on hand −$1,241.76" in amber as if the team were overdrawn (A5-24). Until any money in is
 * recorded it says so instead of showing a negative balance.
 */
function CashKpi({ rollup }: { rollup: LiveView["rollup"] }) {
  if (rollup.receivedIncomeCents <= 0) {
    return (
      <Kpi
        label="Recorded in minus out"
        value="—"
        detail="Shows once money received is recorded. Spending is counted under Committed."
      />
    );
  }
  return (
    <Kpi
      label="Recorded in minus out"
      value={money(rollup.cashPositionCents)}
      detail={rollup.cashPositionCents < 0 ? "More recorded out than in so far" : "Money received minus money spent"}
      tone={rollup.cashPositionCents < 0 ? "warn" : "blue"}
    />
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

/** Whole dollars stay short ("$45"); anything else keeps its cents ("$3.50", not "$4"). */
function wholeOrCents(cents: number): { minimumFractionDigits: number; maximumFractionDigits: number } {
  const digits = Math.round(cents) % 100 === 0 ? 0 : 2;
  return { minimumFractionDigits: digits, maximumFractionDigits: digits };
}
