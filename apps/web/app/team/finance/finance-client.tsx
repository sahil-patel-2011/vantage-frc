"use client";
import { useEffect, useState } from "react";
import { validateBuySheet } from "../../../lib/finance/buy-sheet";

type Category = {
  categoryId: string; name: string; seasonYear: number; planId: string | null;
  monthlyLimitUsd: string | null; totalLimitUsd: string | null; notes: string | null;
};
type PurchaseRequest = {
  id: string; seasonYear: number; categoryId: string | null; categoryName: string | null; requestedByName: string;
  title: string; itemUrl: string | null; quantity: number; unitCostUsd: string; totalCostUsd: string; status: string;
  neededBy?: string | null;
};
type MonthSummary = { month: string; income: number; expense: number; net: number; overMonthlyLimit: boolean };
type DirectoryVendor = { id: string; name: string };

const STATUS_ACTIONS: Record<string, { action: string; label: string }[]> = {
  pending: [{ action: "approve", label: "Approve" }, { action: "reject", label: "Reject" }],
  approved: [{ action: "mark_ordered", label: "Mark ordered" }, { action: "reject", label: "Reject" }],
  ordered: [{ action: "mark_received", label: "Mark received" }],
  received: [{ action: "mark_reimbursed", label: "Mark reimbursed" }],
  rejected: [],
  reimbursed: [],
};

export default function FinanceClient({ orgId }: { orgId: string }) {
  const seasonYear = new Date().getFullYear();
  const [categories, setCategories] = useState<Category[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [totals, setTotals] = useState({ totalIncome: 0, totalExpense: 0, remaining: null as number | null, sponsorCashUsd: 0 });
  const [message, setMessage] = useState("");
  const [budgetForm, setBudgetForm] = useState({ categoryName: "", monthlyLimitUsd: "", totalLimitUsd: "", notes: "" });
  const [vendors, setVendors] = useState<DirectoryVendor[]>([]);
  const [requestForm, setRequestForm] = useState({ title: "", itemUrl: "", quantity: "1", unitCostUsd: "", categoryId: "", vendorId: "", justification: "", neededBy: "" });

  async function load() {
    const [budgetRes, requestsRes, summaryRes, vendorsRes] = await Promise.all([
      fetch(`/api/finance/budget?orgId=${orgId}&seasonYear=${seasonYear}`),
      fetch(`/api/finance/purchase-requests?orgId=${orgId}&seasonYear=${seasonYear}`),
      fetch(`/api/finance/summary?orgId=${orgId}&seasonYear=${seasonYear}`),
      fetch(`/api/vendors?orgId=${orgId}`),
    ]);
    const budgetData = await budgetRes.json();
    const requestsData = await requestsRes.json();
    const summaryData = await summaryRes.json();
    const vendorsData = await vendorsRes.json();
    setCategories(budgetData.categories ?? []);
    setRequests(requestsData.requests ?? []);
    setVendors(Array.isArray(vendorsData.vendors) ? vendorsData.vendors : []);
    setMonths(summaryData.byMonth ?? []);
    setTotals({
      totalIncome: summaryData.totalIncome ?? 0,
      totalExpense: summaryData.totalExpense ?? 0,
      remaining: summaryData.remaining ?? null,
      sponsorCashUsd: summaryData.sponsorCashUsd ?? 0,
    });
    if (!budgetRes.ok) setMessage(budgetData.error);
  }
  useEffect(() => { void load(); }, [orgId]);

  async function saveBudget(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/finance/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, seasonYear, ...budgetForm }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Budget saved." : data.error);
    if (response.ok) { setBudgetForm({ categoryName: "", monthlyLimitUsd: "", totalLimitUsd: "", notes: "" }); await load(); }
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    const sheet = validateBuySheet({
      what: requestForm.title,
      why: requestForm.justification,
      when: requestForm.neededBy,
      cost: requestForm.unitCostUsd,
    });
    if (!sheet.ok) {
      setMessage(sheet.error);
      return;
    }
    const response = await fetch("/api/finance/purchase-requests", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        seasonYear,
        title: sheet.value.title,
        justification: sheet.value.justification,
        neededBy: sheet.value.neededBy,
        unitCostUsd: sheet.value.costUsd,
        itemUrl: requestForm.itemUrl,
        quantity: requestForm.quantity,
        categoryId: requestForm.categoryId || null,
        vendorId: requestForm.vendorId || null,
      }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Purchase request submitted." : data.error);
    if (response.ok) { setRequestForm({ title: "", itemUrl: "", quantity: "1", unitCostUsd: "", categoryId: "", vendorId: "", justification: "", neededBy: "" }); await load(); }
  }

  async function act(id: string, action: string) {
    const response = await fetch("/api/finance/purchase-requests", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, action }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Request ${action.replace("_", " ")}.` : data.error);
    if (response.ok) await load();
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / TEAM FINANCE</span><h1>Season budget &amp; purchase requests</h1></div>
        <nav className="intel-actions"><a href={`/team/sponsors?orgId=${orgId}`}>Sponsors</a><a href={`/team/grants?orgId=${orgId}`}>Grants</a><a href={`/team?orgId=${orgId}`}>Team controls →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      <section className="metric-grid">
        <article><span>Raised this season</span><strong>${totals.totalIncome.toLocaleString()}</strong></article>
        <article><span>Spent this season</span><strong>${totals.totalExpense.toLocaleString()}</strong></article>
        <article><span>Remaining vs. total budget</span><strong>{totals.remaining === null ? "—" : `$${totals.remaining.toLocaleString()}`}</strong></article>
        <article><span>Sponsor cash this season</span><strong>${totals.sponsorCashUsd.toLocaleString()}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={saveBudget}>
          <span className="eyebrow">SET A CATEGORY BUDGET</span>
          <p>Team leads set a monthly and/or season total per spending category (Parts, Travel, Registration, Tools…).</p>
          <label>Category<input required value={budgetForm.categoryName} onChange={(e) => setBudgetForm({ ...budgetForm, categoryName: e.target.value })} placeholder="Parts" /></label>
          <div className="budget-fields">
            <label>Monthly limit ($)<input type="number" min="0" step="0.01" value={budgetForm.monthlyLimitUsd} onChange={(e) => setBudgetForm({ ...budgetForm, monthlyLimitUsd: e.target.value })} /></label>
            <label>Season total ($)<input type="number" min="0" step="0.01" value={budgetForm.totalLimitUsd} onChange={(e) => setBudgetForm({ ...budgetForm, totalLimitUsd: e.target.value })} /></label>
          </div>
          <label>Notes<input value={budgetForm.notes} onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })} /></label>
          <button className="primary-action">Save category budget</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">CATEGORY BUDGETS — {seasonYear}</span>
          {categories.length === 0 && <p>No categories yet — set one to start tracking spend.</p>}
          {categories.map((c) => (
            <article key={c.categoryId}>
              <div><strong>{c.name}</strong><small>{c.monthlyLimitUsd ? `$${Number(c.monthlyLimitUsd).toLocaleString()}/mo` : "no monthly cap"} · {c.totalLimitUsd ? `$${Number(c.totalLimitUsd).toLocaleString()} season` : "no season cap"}</small></div>
            </article>
          ))}
        </section>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={submitRequest}>
          <span className="eyebrow">SUBMIT A PURCHASE (e.g. AMAZON ORDER)</span>
          <label>What<input required value={requestForm.title} onChange={(e) => setRequestForm({ ...requestForm, title: e.target.value })} placeholder="NEO 550 motor x2" /></label>
          <label>Item URL<input type="url" value={requestForm.itemUrl} onChange={(e) => setRequestForm({ ...requestForm, itemUrl: e.target.value })} placeholder="https://www.amazon.com/..." /></label>
          <div className="budget-fields">
            <label>Quantity<input type="number" min="1" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: e.target.value })} /></label>
            <label>Cost ($)<input required type="number" min="0.01" step="0.01" value={requestForm.unitCostUsd} onChange={(e) => setRequestForm({ ...requestForm, unitCostUsd: e.target.value })} /></label>
          </div>
          <label>Category<select value={requestForm.categoryId} onChange={(e) => setRequestForm({ ...requestForm, categoryId: e.target.value })}><option value="">Uncategorized</option>{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select></label>
          <label>Vendor<select required value={requestForm.vendorId} onChange={(e) => setRequestForm({ ...requestForm, vendorId: e.target.value })}>
            <option value="">{vendors.length ? "Choose a vendor" : "Add a vendor first"}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <label>Why<input required value={requestForm.justification} onChange={(e) => setRequestForm({ ...requestForm, justification: e.target.value })} /></label>
          <label>When <small>needed by, optional</small><input type="date" value={requestForm.neededBy} onChange={(e) => setRequestForm({ ...requestForm, neededBy: e.target.value })} /></label>
          <button className="primary-action">Submit request</button>
        </form>
        <section className="intel-panel invite-list">
          <span className="eyebrow">PURCHASE REQUESTS</span>
          {requests.length === 0 && <p>No requests yet.</p>}
          {requests.map((r) => (
            <article key={r.id}>
              <div>
                <strong>{r.title}</strong>
                <small>{r.requestedByName} · {r.quantity} × ${Number(r.unitCostUsd).toFixed(2)} = ${Number(r.totalCostUsd).toFixed(2)} · {r.categoryName ?? "uncategorized"}{r.neededBy ? ` · needed ${r.neededBy}` : ""} · {r.status}</small>
                {r.itemUrl && <div><a href={r.itemUrl} target="_blank" rel="noreferrer">View item ↗</a></div>}
              </div>
              <div>{(STATUS_ACTIONS[r.status] ?? []).map((a) => <button key={a.action} onClick={() => void act(r.id, a.action)}>{a.label}</button>)}</div>
            </article>
          ))}
        </section>
      </section>

      <section className="intel-panel">
        <span className="eyebrow">MONTHLY SPEND — {seasonYear}</span>
        {months.length === 0 && <p>No transactions logged yet this season.</p>}
        {months.map((m) => (
          <article key={m.month}>
            <div><strong>{m.month}</strong><small>Income ${m.income.toLocaleString()} · Expense ${m.expense.toLocaleString()} · Net ${m.net.toLocaleString()}</small></div>
            {m.overMonthlyLimit && <b>OVER BUDGET</b>}
          </article>
        ))}
      </section>
    </main>
  );
}
