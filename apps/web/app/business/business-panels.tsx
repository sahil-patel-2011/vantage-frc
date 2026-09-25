"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import PartnerPlacement from "../../components/partner-placement";
import { EmptyState, Button } from "../../components/ui";
import { ActionMenu, type ActionSpec } from "../../components/ui/action-menu";
import SustainabilityPanel from "./sustainability-panel";
import {
  GRANT_STATUSES,
  sponsorHealth,
  type BusinessView,
  type GrantApplication,
  type PurchaseRequest,
} from "../../lib/business-portal";
import { describeBudgetLine, type BudgetLine, type BudgetVsActualView } from "../../lib/finance/budget-vs-actual";
import { FundraisingGlance } from "./fundraising-glance";
import { dollars, money, moneyWhenRecorded, percent, statusLabel, type Tab } from "./business-helpers";
import { Field, ToneBadge } from "./business-ui";

/** True while this season has nothing recorded at all, so Overview shows one first step instead of a wall of dashes. */
export function businessOverviewIsEmpty(view: BusinessView): boolean {
  return (
    view.budget.totalBudgetCents <= 0 &&
    view.budget.sponsorIncomeCents <= 0 &&
    view.budget.grantIncomeCents <= 0 &&
    view.budget.committedCents <= 0 &&
    view.purchases.length === 0 &&
    view.sponsors.length === 0 &&
    view.grants.length === 0 &&
    view.awards.length === 0 &&
    view.impact.activities === 0 &&
    view.fundraisingProgress.goalCents <= 0 &&
    view.fundraisingProgress.actualCents <= 0
  );
}

export function Overview({ view, setTab }: { view: BusinessView; setTab: (tab: Tab) => void }) {
  const sponsorsAllowed = view.sponsorsAllowed !== false;
  const budgetHref = `/budget?orgId=${encodeURIComponent(view.orgId)}`;
  if (businessOverviewIsEmpty(view)) {
    return (
      <div className="biz-stack">
        <EmptyState
          className="biz-first-step"
          badge="First step"
          title="Set your season budget"
          description={
            view.canManageFinance
              ? "Start with one number: what this season will cost. Money, orders, sponsors and grants all measure against it."
              : "An owner or mentor sets the season budget. Once it is set, this page shows how the money is going."
          }
        >
          {view.canManageFinance ? (
            <Button as="a" variant="primary" href={budgetHref}>
              Set your season budget
            </Button>
          ) : null}
        </EmptyState>
        <p className="app-muted biz-first-step-note">
          Already have orders{sponsorsAllowed ? ", sponsors" : ""} or grants to record? Use the tabs above. This summary
          fills in as soon as anything is recorded.
        </p>
      </div>
    );
  }
  const planCents = view.budget.seasonBudgetCents ?? view.budget.totalBudgetCents;
  const receivedCents = view.budget.sponsorIncomeCents + view.budget.grantIncomeCents;
  const base = planCents > 0 ? planCents : receivedCents;
  // Under 1% says so ("0.4%") instead of rounding a real $45 down to "0%".
  const utilizationExact = base > 0 ? (view.budget.committedCents / base) * 100 : null;
  const utilization =
    utilizationExact == null ? null : utilizationExact > 0 && utilizationExact < 1 ? Math.round(utilizationExact * 10) / 10 : percent(view.budget.committedCents, base);
  // Waiting on someone: requests to review, and approved lines nobody has bought yet (Orders
  // showed "1 approved line waiting on you" while this said "Nothing waiting").
  const submitted = view.purchases.filter((purchase) => purchase.status === "submitted" || purchase.status === "approved");
  const followUps = sponsorsAllowed
    ? view.sponsors.filter((sponsor) => sponsorHealth(sponsor) !== "healthy")
    : [];
  const grantDeadlines = view.grants.filter((grant) => grant.deadline && !["awarded", "declined"].includes(grant.status)).slice(0, 5);
  const reminders = sponsorsAllowed ? view.sponsorReminders.slice(0, 5) : [];
  const progress = view.fundraisingProgress;
  const pulse = view.ordersPulse ?? {
    pendingCount: 0,
    readyToBuyCount: 0,
    openTotalCents: 0,
    financeAiEnabled: false,
    aiHeadline: null,
    aiRecommendations: [] as string[],
  };
  const ordersHref = `/orders?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`;
  const businessOrdersHref = `/business?orgId=${encodeURIComponent(view.orgId)}&tab=orders`;
  const financeAiHref = `/ai?orgId=${encodeURIComponent(view.orgId)}&tab=finance`;
  const costsHref = `/costs?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`;
  return (
    <div className="biz-stack">
      {/* Early warning sits above the KPIs: a team on the death track should read that
          before it reads how much of this season's budget is committed. */}
      <SustainabilityPanel orgId={view.orgId} seasonYear={view.seasonYear} />
      <section className="biz-kpis" aria-label="Season funding summary">
        {/* A budget is a plan, not money in hand: the old first tile added a $5,000 budget
            to cash received as if both were money. They are named apart. */}
        <Kpi
          label={planCents > 0 ? "Season budget" : "Money received"}
          value={planCents > 0 ? money(planCents) : receivedCents > 0 ? money(receivedCents) : "—"}
          detail={
            receivedCents > 0
              ? planCents > 0
                ? `${money(receivedCents)} received from sponsors and grants`
                : "From sponsors and grants · no season budget set"
              : planCents > 0
                ? "Nothing received from sponsors or grants yet"
                : "Set a season budget"
          }
          href={view.budget.totalBudgetCents > 0 ? undefined : budgetHref}
          tone="blue"
        />
        <Kpi
          label="Committed"
          value={moneyWhenRecorded(view.budget.committedCents)}
          detail={
            utilization == null
              ? "Nothing approved or ordered yet"
              : `${utilization}% of ${planCents > 0 ? "the season budget" : "money received"}`
          }
          tone={utilization != null && utilization > 90 ? "danger" : "neutral"}
        />
        {progress.goalCents > 0 || progress.actualCents > 0 ? (
          <Kpi
            label="Raised vs goal"
            value={progress.goalCents > 0 ? `${progress.percentOfGoal}%` : "—"}
            detail={
              progress.goalCents > 0
                ? `${money(progress.actualCents)} of ${money(progress.goalCents)}`
                : `${money(progress.actualCents)} raised · no goal set`
            }
            tone={progress.goalCents > 0 && progress.percentOfGoal >= 100 ? "good" : "blue"}
          />
        ) : null}
        {view.grants.length > 0 ? (
          <Kpi
            label="Grant awards"
            value={moneyWhenRecorded(view.budget.grantIncomeCents)}
            detail={`${view.grants.length} applications tracked`}
            tone="good"
          />
        ) : null}
        {view.purchases.length > 0 ? (
          <>
            <Kpi
              label="Awaiting approval"
              value={moneyWhenRecorded(view.budget.requestedCents)}
              detail={`${pulse.pendingCount} open orders`}
              tone={pulse.pendingCount ? "warn" : "neutral"}
            />
            <Kpi
              label="Ready to buy"
              value={String(pulse.readyToBuyCount)}
              detail={pulse.openTotalCents > 0 ? `${money(pulse.openTotalCents)} open` : "No open orders"}
              tone={pulse.readyToBuyCount ? "warn" : "neutral"}
            />
          </>
        ) : null}
      </section>

      {pulse.financeAiEnabled && pulse.aiHeadline ? (
        <section className="app-card soft-panel" aria-label="Finance assistant on open orders">
          <header className="biz-card-head">
            <div>
              <span className="biz-overline">Finance assistant</span>
              <h2>Open purchase requests</h2>
            </div>
            <Button as="a" variant="secondary" href={ordersHref}>Open orders</Button>
          </header>
          <p style={{ margin: "8px 0", fontWeight: 600 }}>{pulse.aiHeadline}</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {pulse.aiRecommendations.slice(0, 4).map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
          <small className="app-muted" style={{ display: "block", marginTop: 8 }}>
            Suggestions only — no card or bank details are stored. Ask AI about money is under{" "}
            <a href={financeAiHref}>Ask AI</a>.
          </small>
        </section>
      ) : null}

      <FundraisingGlance
        view={view}
        sponsorsAllowed={sponsorsAllowed}
        onOpenSponsors={() => setTab("sponsors")}
        onOpenBudget={() => setTab("budget")}
      />

      <section className="biz-grid two">
        <article className="app-card biz-finance-pulse">
          <header><div><span className="biz-overline">Money</span><h2>Spending so far</h2></div><strong>{utilization == null ? "—" : `${utilization}%`}</strong></header>
          <div className="biz-progress"><i style={{ width: `${utilization ?? 0}%` }} /></div>
          <div className="biz-split-metrics">
            {/* The same two words as Budget and Orders: committed = approved or bought, spent = bought. */}
            <div><span>Committed</span><strong>{moneyWhenRecorded(view.budget.committedCents)}</strong></div>
            <div><span>Spent</span><strong>{moneyWhenRecorded(view.budget.spentCents)}</strong></div>
            <div><span>Raised so far</span><strong>{moneyWhenRecorded(progress.actualCents)}</strong></div>
          </div>
          {/* The one filled button on Overview. The season budget itself is set on /budget. */}
          <ActionMenu
            label="Spending so far"
            maxSecondary={2}
            actions={[
              { id: "finance", label: "Open Money", intent: "primary", onClick: () => setTab("finance") },
              { id: "budget", label: "Season budget", href: budgetHref },
              { id: "orders", label: "Purchase orders", hint: "Approve, order, receive", href: businessOrdersHref },
            ]}
          />
        </article>
        <article className="app-card">
          <header className="biz-card-head"><div><span className="biz-overline">To do</span><h2>Needs attention</h2></div><span className="biz-count">{submitted.length + reminders.length + followUps.length + grantDeadlines.length}</span></header>
          <ul className="biz-action-list">
            {submitted.slice(0, 3).map((purchase) => <li key={purchase.id}><ToneBadge tone="warn">{purchase.status === "approved" ? "To buy" : "Purchase"}</ToneBadge><div><strong>{purchase.itemName}</strong><span>{purchase.status === "approved" ? `${money(purchase.totalCents)} approved, not bought yet` : `${money(purchase.totalCents)} requested by ${purchase.requestedByName}`}</span></div><a href={`${ordersHref}&orderId=${encodeURIComponent(purchase.id)}`}>{purchase.status === "approved" ? "Buy" : "Review"}</a></li>)}
            {reminders.map((reminder) => (
              <li key={`${reminder.kind}-${reminder.sponsorId}`}>
                <ToneBadge tone={reminder.kind === "thank_you" ? "good" : reminder.kind === "renewal" ? "blue" : "danger"}>
                  {reminder.kind === "thank_you" ? "Thank-you" : reminder.kind === "renewal" ? "Renewal" : "Follow-up"}
                </ToneBadge>
                <div>
                  <strong>{reminder.sponsorName}</strong>
                  <span>{reminder.message} · due {reminder.dueOn}</span>
                </div>
                <button type="button" onClick={() => setTab("sponsors")}>Open</button>
              </li>
            ))}
            {followUps.slice(0, 3).map((sponsor) => <li key={sponsor.id}><ToneBadge tone={sponsorHealth(sponsor) === "due" ? "danger" : "warn"}>Sponsor</ToneBadge><div><strong>{sponsor.name}</strong><span>{sponsor.nextFollowUpOn ? `Follow-up ${sponsor.nextFollowUpOn}` : "Needs a next step"}</span></div><button type="button" onClick={() => setTab("sponsors")}>Open</button></li>)}
            {grantDeadlines.map((grant) => <li key={grant.id}><ToneBadge tone="blue">Grant</ToneBadge><div><strong>{grant.title}</strong><span>Due {grant.deadline}</span></div><button type="button" onClick={() => setTab("grants")}>Open</button></li>)}
            {!submitted.length && !reminders.length && !followUps.length && !grantDeadlines.length ? <li className="empty"><strong>Nothing waiting.</strong><span>Purchase requests{sponsorsAllowed ? ", sponsor follow-ups" : ""} and grant deadlines show up here.</span></li> : null}
          </ul>
        </article>
      </section>

      <section className="biz-grid biz-grid-fit">
        {view.budget.monthlySpend.length > 0 ? (
          <article className="app-card"><span className="biz-overline">Orders</span><h2>Committed by month</h2><MonthBars rows={view.budget.monthlySpend} /></article>
        ) : null}
        {sponsorsAllowed && view.sponsors.length > 0 ? (
          <article className="app-card soft-panel"><span className="biz-overline">Sponsors</span><h2>Sponsor contacts</h2><div className="biz-big-stat">{view.interactions.length}</div><p className="app-muted">Calls, emails and meetings logged with sponsors, with next steps.</p><Button variant="secondary" type="button" onClick={() => setTab("sponsors")}>Open sponsors</Button></article>
        ) : null}
        {view.awards.length > 0 || view.impact.activities > 0 ? (
          <article className="app-card soft-panel"><span className="biz-overline">Outreach</span><h2>Awards and outreach</h2><div className="biz-evidence-stats"><b>{view.awards.length}<small>awards</small></b><b>{view.impact.hours}<small>impact hours</small></b><b>{view.impact.peopleReached.toLocaleString()}<small>people reached</small></b></div><Button variant="secondary" type="button" onClick={() => setTab("evidence")}>Open outreach</Button></article>
        ) : null}
        {/* One grid for the smaller cards: two half-empty sections each drew a lone card inside a
            full-width panel. */}
        {sponsorsAllowed && view.sponsors.length > 0 ? (
          <article className="app-card">
            <span className="biz-overline">Sponsors</span>
            <h2>Partner placements</h2>
            <p className="app-muted">Sponsor packages, logo approval and the sponsor strip shown on Home and the pit screen.</p>
            <Button variant="secondary" type="button" onClick={() => setTab("placements")}>Open partners</Button>
          </article>
        ) : null}
        <article className="app-card soft-panel">
          <span className="biz-overline">Event costs</span>
          <h2>Registration, travel and event fees</h2>
          <p className="app-muted">
            Record event fees on the <a href={budgetHref}>season budget</a> or in{" "}
            <a href={costsHref}>Season costs</a>. Ask questions about money under <a href={financeAiHref}>Ask AI</a>.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button as="a" variant="secondary" href={costsHref}>Open Season costs</Button>
          </div>
        </article>
      </section>

      {sponsorsAllowed ? (
        <PartnerPlacement orgId={view.orgId} surface="business_wall" title="Partners powering this team" />
      ) : null}
    </div>
  );
}

function Kpi({ label, value, detail, tone, href }: { label: string; value: string; detail: string; tone: "blue" | "good" | "warn" | "danger" | "neutral"; href?: string }) {
  return <article className={`biz-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{href ? <a href={href}>{detail}</a> : detail}</small></article>;
}

/** "2026-09" as "Sep 2026". */
function monthName(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function MonthBars({ rows }: { rows: BusinessView["budget"]["monthlySpend"] }) {
  const max = Math.max(1, ...rows.map((row) => row.cents));
  if (!rows.length) return <p className="biz-empty-inline">Ordered purchases will appear here by month.</p>;
  return <div className="biz-month-bars">{rows.map((row) => <div key={row.month}><span>{monthName(row.month)}</span><i><b style={{ width: `${Math.max(4, percent(row.cents, max))}%` }} /></i><strong>{money(row.cents)}</strong></div>)}</div>;
}

type Submit = (event: FormEvent<HTMLFormElement>, action: string, dollarFields?: string[]) => Promise<void>;
type Mutate = (payload: Record<string, unknown>) => Promise<boolean>;

export function Budget({ view, busy, submit, mutate }: { view: BusinessView; busy: boolean; submit: Submit; mutate: Mutate }) {
  const categorySpend = useMemo(() => new Map(view.categories.map((category) => [category.id, view.purchases.filter((purchase) => purchase.categoryId === category.id && ["approved", "ordered", "received"].includes(purchase.status)).reduce((total, purchase) => total + purchase.totalCents, 0)])), [view.categories, view.purchases]);
  const financeAiHref = `/ai?tab=finance&orgId=${encodeURIComponent(view.orgId)}`;
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/finance/budget-vs-actual?orgId=${encodeURIComponent(view.orgId)}&seasonYear=${view.seasonYear}`,
    )
      .then(async (response) => {
        const data = (await response.json()) as BudgetVsActualView;
        if (cancelled) return;
        setBudgetLines(data.status === "ready" ? data.lines : []);
      })
      .catch(() => {
        if (!cancelled) setBudgetLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [view.orgId, view.seasonYear]);
  return <div className="biz-stack">
    <section className="biz-grid two">
      <article className="app-card">
        {/* The season budget is set in one place, /budget. This card only reads it. */}
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Season budget</span>
            <h2>
              {(view.budget.seasonBudgetCents ?? 0) > 0
                ? `${money(view.budget.seasonBudgetCents ?? 0)} for ${view.seasonYear}`
                : `No ${view.seasonYear} budget yet`}
            </h2>
            <p className="app-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
              Set on the season budget page and used on every money screen.
            </p>
          </div>
          {view.canManageFinance ? (
            <Button as="a" variant="secondary" href={`/budget?orgId=${encodeURIComponent(view.orgId)}`}>
              {(view.budget.seasonBudgetCents ?? 0) > 0 ? "Change season budget" : "Set season budget"}
            </Button>
          ) : null}
        </header>
        <form className="biz-form-grid" onSubmit={(event) => void submit(event, "save-budget", ["fundraisingGoal"])}>
          <Field label="Fundraising goal" hint="How much you plan to raise from sponsors, grants and fundraisers."><input name="fundraisingGoalDollars" type="number" min="0" step="0.01" defaultValue={dollars(view.budget.fundraisingGoalCents)} disabled={!view.canManageFinance} /></Field>
          <Field label="Notes" wide><textarea name="notes" rows={2} placeholder="Cash reserves, travel plans, school rules…" disabled={!view.canManageFinance} /></Field>
          <Button variant="secondary" disabled={busy || !view.canManageFinance}>Save goal</Button>
        </form>
        {view.canManageFinance ? <form className="biz-inline-form" onSubmit={(event) => void submit(event, "add-category", ["allocated"])}><input name="name" aria-label="Category name" placeholder="Category (Robot, Travel, Outreach…)" required /><input name="allocatedDollars" aria-label="Amount for this category" type="number" min="0" step="0.01" placeholder="Amount" required /><button disabled={busy}>Add or update category</button></form> : null}
        <p className="app-muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
          Event fees go in <a href={`/costs?orgId=${encodeURIComponent(view.orgId)}`}>Season costs</a>. Ask questions about money in <a href={financeAiHref}>Ask AI</a>.
        </p>
      </article>
      <article className="app-card biz-order-form">
        <span className="biz-overline">Purchases</span><h2>Request a purchase</h2>
        <form className="biz-form-grid" onSubmit={(event) => void submit(event, "submit-purchase", ["unitPrice", "shipping"])}>
          <Field label="Item" wide><input name="itemName" required placeholder="2 × 1 aluminum tube" /></Field>
          <Field label="Vendor"><input name="vendor" defaultValue="Amazon" required /></Field>
          <Field label="Product URL"><input name="itemUrl" type="url" placeholder="https://…" /></Field>
          <Field label="Budget category"><select name="categoryId" defaultValue=""><option value="">Uncategorized</option>{view.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
          <Field label="Quantity"><input name="quantity" type="number" min="1" defaultValue="1" required /></Field>
          <Field label="Unit price"><input name="unitPriceDollars" type="number" min="0" step="0.01" required /></Field>
          <Field label="Shipping / tax estimate"><input name="shippingDollars" type="number" min="0" step="0.01" defaultValue="0" /></Field>
          <Field label="Needed by"><input name="neededBy" type="date" /></Field>
          <Field label="Why the team needs it" hint="Approvers should understand the outcome, not just the part." wide><textarea name="purpose" required rows={3} placeholder="Needed to finish the elevator rebuild before our first event…" /></Field>
          <Button variant="primary" disabled={busy}>Submit for approval</Button>
        </form>
      </article>
    </section>

    {budgetLines.length > 0 ? (
      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Budget vs recorded spend</span>
            <h2>Planned vs spent by category</h2>
          </div>
        </header>
        <div className="biz-category-grid">
          {budgetLines.map((line) => (
            <article key={line.categoryId ?? line.name}>
              <header>
                <strong>{line.name}</strong>
              </header>
              <footer>
                <span>{describeBudgetLine(line)}</span>
              </footer>
            </article>
          ))}
        </div>
      </section>
    ) : null}

    <section className="app-card">
      <header className="biz-card-head"><div><span className="biz-overline">Categories</span><h2>Planned vs approved</h2></div><strong>{money(view.categories.reduce((total, category) => total + category.allocatedCents, 0))} allocated</strong></header>
      <div className="biz-category-grid">{view.categories.map((category) => { const spent = categorySpend.get(category.id) ?? 0; const used = percent(spent, category.allocatedCents); return <article key={category.id}><header><strong>{category.name}</strong><span>{used}%</span></header><div className="biz-progress"><i style={{ width: `${used}%` }} /></div><footer><span>{money(spent)} committed</span><span>{money(category.allocatedCents)} allocated</span></footer></article>; })}{!view.categories.length ? <p className="biz-empty-inline">Owners and mentors can add categories (robot, travel, outreach…) so requests add up by category.</p> : null}</div>
    </section>

    <section className="app-card">
      <header className="biz-card-head"><div><span className="biz-overline">Purchases</span><h2>Purchase requests</h2></div><span className="biz-count">{view.purchases.length}</span></header>
      <div className="biz-table-wrap"><table className="biz-table"><thead><tr><th>Request</th><th>Category</th><th>Total</th><th>Needed</th><th>Status</th><th>Action</th></tr></thead><tbody>{view.purchases.map((purchase) => <PurchaseRow key={purchase.id} purchase={purchase} canManage={view.canManageFinance} busy={busy} mutate={mutate} />)}{!view.purchases.length ? <tr><td colSpan={6}>No purchase requests yet. Students can submit the first one above.</td></tr> : null}</tbody></table></div>
    </section>
  </div>;
}

function PurchaseRow({ purchase, canManage, busy, mutate }: { purchase: PurchaseRequest; canManage: boolean; busy: boolean; mutate: Mutate }) {
  const next: Partial<Record<PurchaseRequest["status"], PurchaseRequest["status"]>> = { submitted: "approved", approved: "ordered", ordered: "received" };
  const nextStatus = next[purchase.status];
  // One move forward is the loud control; rejecting a student's request is a deliberate,
  // confirmed choice behind the overflow — never a button sitting next to "Approve".
  const rowActions: ActionSpec[] = nextStatus
    ? [
        {
          id: "advance",
          label: nextStatus === "approved" ? "Approve" : nextStatus === "ordered" ? "Mark ordered" : "Received",
          intent: "primary",
          disabled: busy,
          onClick: () => void mutate({ action: "set-purchase-status", purchaseId: purchase.id, status: nextStatus }),
        },
        ...(purchase.status === "submitted"
          ? [
              {
                id: "reject",
                label: "Reject request",
                intent: "destructive",
                disabled: busy,
                hint: `Tells ${purchase.requestedByName} this purchase is not happening`,
                onClick: () => void mutate({ action: "set-purchase-status", purchaseId: purchase.id, status: "rejected" }),
              } satisfies ActionSpec,
            ]
          : []),
      ]
    : [];
  return <tr><td><strong>{purchase.itemName}</strong><small>{purchase.quantity} × {money(purchase.unitPriceCents)} · {purchase.vendor} · {purchase.requestedByName}</small>{purchase.itemUrl ? <a href={purchase.itemUrl} target="_blank" rel="noreferrer">Product link ↗</a> : null}<p>{purchase.purpose}</p></td><td>{purchase.categoryName ?? "Uncategorized"}</td><td><strong>{money(purchase.totalCents)}</strong></td><td>{purchase.neededBy ?? "—"}</td><td><ToneBadge tone={purchase.status === "rejected" ? "danger" : purchase.status === "received" ? "good" : purchase.status === "submitted" ? "warn" : "blue"}>{statusLabel(purchase.status)}</ToneBadge></td><td>{canManage && nextStatus ? <div className="biz-row-actions"><ActionMenu tone="row" maxSecondary={0} label={`${purchase.itemName} request`} triggerTestId={`purchase-more:${purchase.id}`} actions={rowActions} /></div> : <span className="app-muted">{purchase.orderedOn ?? "—"}</span>}</td></tr>;
}

export function Grants({ view, busy, submit, mutate }: { view: BusinessView; busy: boolean; submit: Submit; mutate: Mutate }) {
  const [selectedDraft, setSelectedDraft] = useState(view.drafts[0]?.id ?? "");
  const draft = view.drafts.find((item) => item.id === selectedDraft) ?? view.drafts[0];
  return (
    <div className="biz-stack">
      <div className="biz-detail-link">
        <span>
          Guided need · impact · budget · timeline essays live in Grant writing. Reporting on an award you already won:
        </span>
        <a href={`/grant-report?orgId=${encodeURIComponent(view.orgId)}`}>Grant report →</a>
      </div>
      {!view.grants.length ? (
        <EmptyState
          soft
          badge={view.canManageFinance ? "Get started" : "Needs setup"}
          badgeTone={view.canManageFinance ? "" : "setup"}
          title={view.canManageFinance ? "No grant applications yet" : "Grant pipeline is empty"}
          description="Add an opportunity in the form below, or write in Grant writing. Award $ appears only after you record a real award."
        />
      ) : null}
      <section className="biz-grid two">
        <article className="app-card">
          <span className="biz-overline">Grant pipeline</span>
          <h2>Turn a deadline into an owned plan.</h2>
          <form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-grant", ["requested"])}>
            <Field label="Funder">
              <input name="funder" required placeholder="Community Foundation" />
            </Field>
            <Field label="Opportunity">
              <input name="title" required placeholder="Youth STEM Innovation Grant" />
            </Field>
            <Field label="Source">
              <input name="sourceUrl" type="url" placeholder="https://…" />
            </Field>
            <Field label="Deadline">
              <input name="deadline" type="date" />
            </Field>
            <Field label="Request amount" hint="Optional ask — leave blank rather than inventing an award.">
              <input name="requestedDollars" type="number" min="0" step="0.01" placeholder="Your ask" />
            </Field>
            <Field label="Owner">
              <input name="ownerName" placeholder="Student + mentor pair" />
            </Field>
            <Field label="Purpose / project" wide>
              <textarea name="purpose" required rows={3} placeholder="Exactly what this funding would make possible…" />
            </Field>
            <Field label="Eligibility" wide>
              <textarea name="eligibility" rows={2} placeholder="501(c)(3), geography, grade levels…" />
            </Field>
            <Field label="Requirements" wide>
              <textarea name="requirements" rows={2} placeholder="Prompts, attachments, character limits, reporting…" />
            </Field>
            <Button variant="primary" disabled={busy}>
              Add to pipeline
            </Button>
          </form>
        </article>
        <article className="app-card biz-writer">
          <span className="biz-overline">Template writing studio</span>
          <h2>Draft faster without inventing a single metric.</h2>
          <p>
            Template drafts pull only from this team&apos;s Impact log and award history. For help writing, open Grant writing or Writer.
          </p>
          <form className="biz-form-grid" onSubmit={(event) => void submit(event, "generate-draft")}>
            <Field label="Document">
              <select name="documentType" defaultValue="grant_narrative">
                <option value="grant_narrative">Grant narrative</option>
                <option value="sponsor_email">Sponsor introduction</option>
                <option value="thank_you">Sponsor thank-you</option>
                <option value="renewal">Renewal request</option>
              </select>
            </Field>
            <Field label="Audience">
              <input name="audience" required placeholder="Foundation review committee" />
            </Field>
            <Field label="Sponsor (optional)">
              <select name="sponsorName" defaultValue="">
                <option value="">No specific sponsor</option>
                {view.sponsors.map((sponsor) => (
                  <option key={sponsor.id}>{sponsor.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Goal" wide>
              <textarea name="goal" rows={3} required placeholder="Fund student tool certifications and safety equipment…" />
            </Field>
            <Button variant="primary" disabled={busy}>
              Create sourced draft
            </Button>
          </form>
        </article>
      </section>

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Application board</span>
            <h2>Research → draft → review → submit → report</h2>
          </div>
          <span className="biz-count">{view.grants.length}</span>
        </header>
        <div className="biz-grant-board">
          {GRANT_STATUSES.map((status) => (
            <div key={status}>
              <header>
                <span>{statusLabel(status)}</span>
                <b>{view.grants.filter((grant) => grant.status === status).length}</b>
              </header>
              {view.grants
                .filter((grant) => grant.status === status)
                .map((grant) => (
                  <GrantCard key={grant.id} grant={grant} canManage={view.canManageFinance} busy={busy} mutate={mutate} />
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="app-card">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Draft library</span>
            <h2>Reusable writing with its receipts attached</h2>
          </div>
          {view.drafts.length ? (
            <select value={draft?.id} onChange={(event) => setSelectedDraft(event.target.value)}>
              {view.drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : null}
        </header>
        {draft ? (
          <div className="biz-draft">
            <article>
              <pre>{draft.body}</pre>
              <button type="button" onClick={() => void navigator.clipboard.writeText(draft.body)}>
                Copy draft
              </button>
            </article>
            <aside>
              <h3>Evidence used</h3>
              {draft.evidence.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                  {item.source.startsWith("http") ? (
                    <a href={item.source} target="_blank" rel="noreferrer">
                      Source ↗
                    </a>
                  ) : (
                    <small>{item.source}</small>
                  )}
                </div>
              ))}
              {!draft.evidence.length ? (
                <p>No quantitative evidence was available. Add verified Impact activities or awards before final submission.</p>
              ) : null}
              <p className="biz-review-warning">
                Human review required before sending. Confirm names, requirements, dates, and every claim.
              </p>
            </aside>
          </div>
        ) : (
          <EmptyState
            soft
            title="No sourced drafts yet"
            description="Generate a template draft above, or open Grant writing for guided fields."
          >
            <Button as="a" variant="primary" href={`/team/grants?orgId=${encodeURIComponent(view.orgId)}`}>
              Open grant writing
            </Button>
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function GrantCard({ grant, canManage, busy, mutate }: { grant: GrantApplication; canManage: boolean; busy: boolean; mutate: Mutate }) {
  const index = GRANT_STATUSES.indexOf(grant.status);
  const next = GRANT_STATUSES[Math.min(index + 1, GRANT_STATUSES.length - 1)] ?? grant.status;
  const canAdvance = !["awarded", "declined"].includes(grant.status) && next !== grant.status;
  return <article><strong>{grant.title}</strong><span>{grant.funder}</span><small>{grant.deadline ? `Due ${grant.deadline}` : "No deadline"} · {money(grant.requestedCents)}</small><p>{grant.purpose}</p>{grant.sourceUrl ? <a href={grant.sourceUrl} target="_blank" rel="noreferrer">Opportunity source ↗</a> : null}{canAdvance ? <button disabled={busy || (next === "awarded" && !canManage)} onClick={() => void mutate({ action: "set-grant-status", grantId: grant.id, status: next, awardedCents: next === "awarded" ? grant.requestedCents : 0 })}>Move to {statusLabel(next)}</button> : null}</article>;
}

export function Evidence({ view, busy, submit }: { view: BusinessView; busy: boolean; submit: Submit }) {
  const grouped = useMemo(() => {
    const byYear = new Map<number, BusinessView["awards"]>();
    for (const award of view.awards) byYear.set(award.seasonYear, [...(byYear.get(award.seasonYear) ?? []), award]);
    return byYear;
  }, [view.awards]);
  return <div className="biz-stack">
    <div className="biz-detail-link">
      <span>Need FIRST catalog prompts, essay drafts, character limits, and submission status?</span>
      <a href={`/team/awards?orgId=${encodeURIComponent(view.orgId)}`}>Open awards →</a>
    </div>
    <section className="biz-grid two"><article className="app-card"><span className="biz-overline">Verified achievement record</span><h2>Add an award once. Reuse it for years.</h2><form className="biz-form-grid" onSubmit={(event) => void submit(event, "add-award")}><Field label="Award"><input name="awardName" required placeholder="Engineering Inspiration Award" /></Field><Field label="Event"><input name="eventName" placeholder="District Championship" /></Field><Field label="Level"><input name="awardLevel" placeholder="Winner, finalist, district…" /></Field><Field label="Official source"><input name="sourceUrl" type="url" placeholder="https://…" /></Field><Field label="Why it mattered" hint="Capture the story future students would otherwise lose." wide><textarea name="story" rows={4} placeholder="What the team did, who led it, and what changed…" /></Field><Button variant="primary" disabled={busy}>Add award to {view.seasonYear}</Button></form></article><article className="app-card biz-impact-link"><span className="biz-overline">Live impact evidence</span><h2>Your grant facts are only as strong as this log.</h2><div className="biz-evidence-stats"><b>{view.impact.activities}<small>activities</small></b><b>{view.impact.hours}<small>hours</small></b><b>{view.impact.peopleReached.toLocaleString()}<small>people reached</small></b></div><p>These figures flow directly into sourced writing drafts. Add outreach, mentoring, demos, and service in Community Impact.</p><Button as="a" variant="secondary" href={`/impact?orgId=${encodeURIComponent(view.orgId)}&season=${view.seasonYear}`}>Open Community Impact</Button></article></section><section className="app-card"><header className="biz-card-head"><div><span className="biz-overline">Team history</span><h2>The proof that graduates with the team—not with a person.</h2></div><span className="biz-count">{view.awards.length}</span></header><div className="biz-award-years">{[...grouped.entries()].sort(([a], [b]) => b - a).map(([year, awards]) => <section key={year}><h3>{year}</h3><div>{awards.map((award) => <article key={award.id}><ToneBadge tone="good">Achievement</ToneBadge><strong>{award.awardName}</strong><span>{[award.eventName, award.awardLevel].filter(Boolean).join(" · ") || "Team record"}</span>{award.story ? <p>{award.story}</p> : null}{award.sourceUrl ? <a href={award.sourceUrl} target="_blank" rel="noreferrer">Verify source ↗</a> : null}</article>)}</div></section>)}{!view.awards.length ? <p className="biz-empty-inline">Start with the team’s most recent judged or competition award.</p> : null}</div></section>
  </div>;
}
