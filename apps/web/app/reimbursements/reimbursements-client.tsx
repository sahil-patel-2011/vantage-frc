"use client";

/**
 * Reimbursements — the surface a treasurer-parent actually opens.
 *
 * Three jobs, top to bottom:
 *  1. File a claim: amount, what it was for, and a PDF receipt document.
 *  2. Work the queue: approve, deny, mark paid. Only a finance manager (0714 —
 *     the team owner, or someone the owner chose to manage money) sees those
 *     buttons, and only a PAID claim moves the team's balance.
 *  3. "Season money at a glance": budget versus actual by category, and the
 *     one-file season financial report a treasurer hands to next year's.
 *
 * Honesty rules: no number on this page is estimated. A category with no budget
 * says so instead of showing a percentage; an empty queue shows zeros; a failed
 * load shows the real message with a retry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel, askText } from "../../components/ui";
import {
  BUDGET_CLOSE_RATIO,
  describeBudgetLine,
  type BudgetLine,
  type BudgetVsActualView,
} from "../../lib/finance/budget-vs-actual";
import { formatUsd } from "../../lib/finance/format-usd";
import {
  MAX_RECEIPT_BYTES,
  MIN_DENIAL_NOTE_LENGTH,
  RECEIPT_PDF_HELP,
  REIMBURSEMENT_STATUS_LABELS,
  availableActions,
  evaluateReceiptUpload,
  formatBytes,
  reimbursementHint,
  type ReimbursementAction,
  type ReimbursementSummary,
  type ReimbursementsView,
} from "../../lib/finance/reimbursements";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { actionFailureMessage } from "../../lib/ui/action-failure";
import "./reimbursements.css";

const ACTION_LABELS: Record<ReimbursementAction, string> = {
  submit: "Submit for approval",
  withdraw: "Withdraw",
  approve: "Approve",
  deny: "Deny",
  mark_paid: "Mark paid",
  unmark_paid: "Undo payment",
  reopen: "Reopen as draft",
};

/** What happened, in the words of the person who pressed the button. */
const ACTION_DONE: Record<ReimbursementAction, string> = {
  submit: "Submitted. It waits for someone who manages money to approve it.",
  withdraw: "Withdrawn. It is a draft again.",
  approve: "Approved. Mark it paid once the money has gone back.",
  deny: "Denied. The person who filed it sees your reason.",
  mark_paid: "Marked paid and recorded in the team ledger.",
  unmark_paid: "Payment undone. It is approved and not paid again.",
  reopen: "Reopened as a draft. The denial note stays on it so you can see what to fix.",
};

/** Actions that read as the obvious next step get the filled treatment. */
const PRIMARY_ACTIONS = new Set<ReimbursementAction>(["submit", "approve", "mark_paid"]);

const money = formatUsd;

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type Status = "loading" | "ready" | "error";

function isReimbursementsView(value: unknown): value is ReimbursementsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function reimbursementsCacheOrg(data: ReimbursementsView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistReimbursementsSnapshot(orgHint: string, data: ReimbursementsView): Promise<void> {
  const cacheOrg = reimbursementsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("reimbursements", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("reimbursements", "_", data);
  } catch {
    // Live Reimbursements already painted; IndexedDB is best-effort.
  }
}

export default function ReimbursementsClient() {
  const [view, setView] = useState<ReimbursementsView | null>(null);
  const [budget, setBudget] = useState<BudgetVsActualView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ReimbursementsView | null>(null);
  viewRef.current = view;

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchasedOn, setPurchasedOn] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const receiptInput = useRef<HTMLInputElement | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ReimbursementsView>("reimbursements", orgHint || "_");
      if (!viewRef.current && cached?.data && isReimbursementsView(cached.data)) {
        setView(cached.data);
        setStatus("ready");
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!hadCache) setStatus("loading");
    try {
      const response = await fetch(`/api/reimbursements${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const next: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setBudget(null);
        setFromCache(false);
        setCachedAt(null);
        setStatus("error");
        setError(
          next && typeof next === "object" && "error" in next && typeof next.error === "string"
            ? next.error
            : "Could not load reimbursements.",
        );
        return;
      }
      if (!response.ok || !isReimbursementsView(next)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setStatus("ready");
          setError("Could not refresh Reimbursements. Showing the last copy on this device.");
          return;
        }
        setStatus("error");
        setError(
          next && typeof next === "object" && "error" in next && typeof next.error === "string"
            ? next.error
            : "Could not load reimbursements.",
        );
        return;
      }
      setView(next);
      setStatus("ready");
      setError(null);
      setFromCache(false);
      setCachedAt(null);
      await persistReimbursementsSnapshot(orgHint, next);
      if (next.status !== "ready") {
        setBudget(null);
        return;
      }
      try {
        const budgetResponse = await fetch(
          `/api/finance/budget-vs-actual?orgId=${encodeURIComponent(next.orgId)}&seasonYear=${next.seasonYear}`,
          { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
        );
        const budgetData = (await budgetResponse.json()) as BudgetVsActualView;
        setBudget(budgetData);
      } catch {
        setBudget(null);
      }
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setStatus("ready");
        setError("Could not refresh Reimbursements. Showing the last copy on this device.");
        return;
      }
      setStatus("error");
      setError("Could not load reimbursements.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickReceipt = useCallback((file: File | null) => {
    setNotice(null);
    if (!file) {
      setReceipt(null);
      return;
    }
    const verdict = evaluateReceiptUpload({ mediaType: file.type, byteSize: file.size });
    if (!verdict.ok) {
      setError(verdict.reason);
      setReceipt(null);
      return;
    }
    setError(null);
    setReceipt(file);
  }, []);

  const fileClaim = useCallback(async () => {
    if (!orgId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await fetch("/api/reimbursements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          amountUsd: amount,
          description,
          categoryId: categoryId || null,
          purchasedOn: purchasedOn || null,
          seasonYear: view && view.status === "ready" ? view.seasonYear : undefined,
        }),
      });
      const body = (await created.json()) as { id?: string; error?: string };
      if (!created.ok || !body.id) throw new Error(body.error ?? "Could not file that reimbursement.");

      if (receipt) {
        const prepared = receipt;
        const verdict = evaluateReceiptUpload({ mediaType: prepared.type, byteSize: prepared.size });
        if (!verdict.ok) throw new Error(verdict.reason);
        const form = new FormData();
        form.set("orgId", orgId);
        form.set("receipt", prepared, receipt.name || "receipt.pdf");
        const uploaded = await fetch(`/api/reimbursements/${body.id}/receipt`, { method: "POST", body: form });
        if (!uploaded.ok) {
          const failure = (await uploaded.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error ?? "The claim was saved but the receipt did not upload.");
        }
      }

      setAmount("");
      setDescription("");
      setCategoryId("");
      setPurchasedOn("");
      setReceipt(null);
      if (receiptInput.current) receiptInput.current.value = "";
      setNotice(
        receipt
          ? "Saved as a draft with its receipt. Submit it when you are ready."
          : "Saved as a draft. Attach the PDF receipt, then submit it.",
      );
      load();
    } catch (cause: unknown) {
      setError(actionFailureMessage(cause, "Could not file that reimbursement."));
    } finally {
      setBusy(false);
    }
  }, [orgId, busy, amount, description, categoryId, purchasedOn, receipt, view, load]);

  const act = useCallback(
    async (id: string, action: ReimbursementAction) => {
      if (!orgId || busy) return;
      let note: string | null = null;
      if (action === "deny") {
        // Asked before anything is sent; Cancel keeps the claim as it is. A denial always
        // carries a reason (the API refuses one without), so the filer knows what to fix.
        const reason = await askText({
          title: "Deny this claim?",
          body: "The person who filed it sees your reason and can fix the claim and send it again.",
          confirmLabel: "Deny claim",
          tone: "destructive",
          input: {
            label: "Why it is denied",
            placeholder: "The receipt doesn't show the total. Attach the full receipt.",
            required: true,
            multiline: true,
          },
        });
        if (reason === null) return;
        note = reason.trim();
        if (note.length < MIN_DENIAL_NOTE_LENGTH) {
          setError("Say why the claim is denied, so the person who filed it knows what to fix.");
          return;
        }
      }
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`/api/reimbursements/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action, decisionNote: note }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not update that reimbursement.");
        setNotice(ACTION_DONE[action]);
        load();
      } catch (cause: unknown) {
        setError(actionFailureMessage(cause, "Could not update that reimbursement."));
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, load],
  );

  const attachReceipt = useCallback(
    async (id: string, file: File) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const prepared = file;
        const verdict = evaluateReceiptUpload({ mediaType: prepared.type, byteSize: prepared.size });
        if (!verdict.ok) throw new Error(verdict.reason);
        const form = new FormData();
        form.set("orgId", orgId);
        form.set("receipt", prepared, file.name || "receipt.pdf");
        const response = await fetch(`/api/reimbursements/${id}/receipt`, { method: "POST", body: form });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error ?? "Could not attach that receipt.");
        }
        setNotice("Receipt attached.");
        load();
      } catch (cause: unknown) {
        setError(actionFailureMessage(cause, "Could not attach that receipt."));
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, load],
  );

  const ready = view && view.status === "ready" ? view : null;
  const canFile = Boolean(orgId) && amount.trim() !== "" && description.trim() !== "" && !busy;

  const budgetLines = useMemo<BudgetLine[]>(
    () => (budget && budget.status === "ready" ? budget.lines : []),
    [budget],
  );

  const filePanel = !ready ? null : ready.canFile === false ? (
    <Panel>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>File a claim</h2>
      <p className="rb-meta">You have view-only access, so you can&rsquo;t file a reimbursement claim.</p>
    </Panel>
  ) : (
    <Panel>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{ready.isTreasurer ? "File your own claim" : "File a claim"}</h2>
      <div className="rb-form">
        <div className="rb-form-grid">
          <label className="rb-field">
            <span>Amount you paid</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="180.00"
            />
          </label>
          <label className="rb-field">
            <span>Date of purchase</span>
            <input
              type="date"
              value={purchasedOn}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setPurchasedOn(event.target.value)}
            />
          </label>
          <label className="rb-field">
            <span>Budget category</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Uncategorized</option>
              {ready.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="rb-field">
          <span>What was it for?</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Replacement gearbox for the west drivetrain, bought at the venue"
            maxLength={500}
          />
        </label>
        <div className="rb-form-actions">
          <label className="rb-receipt-pick">
            {receipt ? `Receipt: ${receipt.name} (${formatBytes(receipt.size)})` : "Add PDF receipt"}
            <input
              ref={receiptInput}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => pickReceipt(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            className="rb-receipt-pick"
            style={{ borderStyle: "solid" }}
            disabled={!canFile}
            onClick={() => void fileClaim()}
          >
            {busy ? "Saving…" : "Save draft"}
          </button>
        </div>
        <p className="rb-meta">
          {`Attach the receipt as a PDF, up to ${formatBytes(MAX_RECEIPT_BYTES)}, to submit. Without one the claim stays a draft.`}
        </p>
        <p className="rb-meta">{RECEIPT_PDF_HELP}</p>
        {ready.isTreasurer ? (
          <p className="rb-meta">Someone else who manages money approves and pays a claim you file.</p>
        ) : null}
      </div>
    </Panel>
  );

  const claimsPanel = !ready ? null : (
    <Panel>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>
        {ready.isTreasurer ? "Claims to review" : "Your claims"}
      </h2>
      {ready.requests.length === 0 ? (
        <EmptyState
          soft
          title="No reimbursements yet"
          description={
            ready.isTreasurer
              ? "When someone on the team pays out of pocket and files a claim, it lands here for you to approve."
              : "Filed a claim above? It will show here as a draft until you submit it."
          }
        />
      ) : (
        <ul className="rb-list">
          {ready.requests.map((request) => (
            <ClaimRow
              key={request.id}
              request={request}
              orgId={ready.orgId}
              isTreasurer={ready.isTreasurer}
              viewerUserId={ready.viewerUserId}
              busy={busy}
              onAct={act}
              onAttach={attachReceipt}
            />
          ))}
        </ul>
      )}
    </Panel>
  );

  return (
    <div className="rb-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/business", orgId)}>Business</a>
            {" / Reimbursements"}
          </>
        }
        title="Reimbursements"
        description="Money someone on the team already spent out of their own pocket — filed with a receipt, approved once, paid once, and recorded in the team ledger."
      />
      <OfflineBanner feature="Reimbursements" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="rb-alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rb-note" role="status">
          {notice}
        </p>
      ) : null}

      {status === "loading" && !view ? <EmptyState title="Loading reimbursements…" aria-busy /> : null}

      {status === "error" && !view ? (
        <EmptyState
          title="Could not load reimbursements"
          description={error ?? "That didn't go through. Check your connection and try again."}
        >
          <button type="button" className="rb-receipt-pick" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      ) : null}

      {view && view.status === "setup_required" ? (
        <EmptyState
          title="Choose your team"
          badge="Needs setup"
          badgeTone="setup"
          description={view.message}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : null}

      {ready ? (
        <>
          <dl className="rb-totals">
            <div className="rb-total">
              <dt>Waiting for approval</dt>
              <dd>{money(ready.totals.awaitingDecisionUsd)}</dd>
              <small>
                {ready.totals.awaitingDecisionCount} claim
                {ready.totals.awaitingDecisionCount === 1 ? "" : "s"} submitted
              </small>
            </div>
            <div className="rb-total">
              <dt>Approved, not paid yet</dt>
              <dd>{money(ready.totals.approvedUnpaidUsd)}</dd>
              <small>Owed back to the people who paid. It counts against the balance once it is paid.</small>
            </div>
            <div className="rb-total">
              <dt>Paid back this season</dt>
              <dd>{money(ready.totals.paidUsd)}</dd>
              <small>
                {ready.totals.paidCount} claim{ready.totals.paidCount === 1 ? "" : "s"} in the team ledger
              </small>
            </div>
          </dl>

          {/* Someone who manages money opens this page to decide claims, so their queue comes
              first; everyone else came to file one. */}
          {ready.isTreasurer ? claimsPanel : filePanel}
          {ready.isTreasurer ? filePanel : claimsPanel}

          <Panel>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Season money at a glance</h2>
            <p className="rb-meta" style={{ marginBottom: 12 }}>
              Every budget category for {ready.seasonYear}, against what the unified ledger says was actually
              spent — orders, receipts, paid season costs, and paid reimbursements.
            </p>
            {budget && budget.status === "setup_required" ? (
              <EmptyState soft title="Not available yet" description={budget.message}>
                <Button as="a" variant="primary" href={withOrgHref("/team/budgets", orgId)}>
                  Open Budget
                </Button>
              </EmptyState>
            ) : budget && budget.status === "ready" && budget.hasData ? (
              <>
                <div className="rb-budget-lines">
                  {budgetLines.map((line) => (
                    <BudgetRow key={line.categoryId ?? "uncategorized"} line={line} />
                  ))}
                </div>
                <p className="rb-meta" style={{ marginTop: 12 }}>
                  {money(budget.totals.spentUsd)} spent against {money(budget.totals.budgetedUsd)} budgeted
                  {budget.totals.overCount > 0
                    ? ` — ${budget.totals.overCount} categor${budget.totals.overCount === 1 ? "y is" : "ies are"} over.`
                    : "."}
                  {budget.totals.uncategorizedUsd > 0
                    ? ` ${money(budget.totals.uncategorizedUsd)} of that spend has no category yet.`
                    : ""}
                </p>
              </>
            ) : (
              <EmptyState
                soft
                title="No budgets or spend recorded for this season"
                description="Set category budgets on the finance desk and record spend through orders, receipts, or reimbursements — this panel fills in from real rows only."
              />
            )}
          </Panel>

          {ready.isTreasurer ? (
            <Panel>
              <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Season financial report</h2>
              <div className="rb-export">
                <a href={`/api/finance/season-report?orgId=${encodeURIComponent(ready.orgId)}`}>
                  Download CSV
                </a>
                <p>
                  Every dollar in and out, oldest first, with a running balance that closes on the team&rsquo;s
                  current balance. This is the file you hand to next year&rsquo;s treasurer.
                </p>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function BudgetRow({ line }: { line: BudgetLine }) {
  // A ratio only exists when a positive budget exists; the bar is capped at
  // 100% width and the "over" colour (plus the caption) carries the overage.
  const width =
    line.consumedRatio == null ? 0 : Math.max(0, Math.min(1, line.consumedRatio)) * 100;
  return (
    <div className="rb-budget-line" data-state={line.state}>
      <div className="rb-budget-head">
        <b>{line.name}</b>
        <span className="rb-meta">
          {line.consumedRatio == null
            ? line.budgetUsd == null
              ? "No budget"
              : "No budget to compare"
            : `${Math.round(line.consumedRatio * 100)}% of budget`}
        </span>
      </div>
      <div
        className="rb-budget-track"
        role="img"
        aria-label={describeBudgetLine(line)}
        title={
          line.state === "close" ? `At or past ${Math.round(BUDGET_CLOSE_RATIO * 100)}% of budget` : undefined
        }
      >
        <div className="rb-budget-fill" style={{ width: `${width}%` }} />
      </div>
      <p className="rb-meta">{describeBudgetLine(line)}</p>
    </div>
  );
}

function ClaimRow({
  request,
  orgId,
  isTreasurer,
  viewerUserId,
  busy,
  onAct,
  onAttach,
}: {
  request: ReimbursementSummary;
  orgId: string;
  isTreasurer: boolean;
  viewerUserId: string;
  busy: boolean;
  onAct: (id: string, action: ReimbursementAction) => void | Promise<void>;
  onAttach: (id: string, file: File) => void | Promise<void>;
}) {
  const isOwnClaim = request.memberUserId === viewerUserId;
  const actions = availableActions({
    status: request.status,
    actor: isTreasurer ? "admin" : "member",
    isOwnClaim,
    hasReceipt: request.hasReceipt,
  });
  const canReplaceReceipt =
    (isOwnClaim || isTreasurer) && request.status !== "approved" && request.status !== "paid";
  const decided = shortDate(request.decidedAt);
  const paid = shortDate(request.paidAt);
  const purchased = request.purchasedOn ? shortDate(`${request.purchasedOn}T00:00:00Z`) : null;

  return (
    <li className="rb-claim">
      <div className="rb-claim-head">
        <strong>{request.description}</strong>
        <span className="rb-amount">{money(request.amountUsd)}</span>
      </div>
      <span className={`rb-chip ${request.status}`}>{REIMBURSEMENT_STATUS_LABELS[request.status]}</span>
      <p className="rb-meta">
        {reimbursementHint(request.status, { isOwnClaim })}
        {!isOwnClaim && request.memberName ? ` · Filed by ${request.memberName}` : ""}
        {purchased ? ` · Purchased ${purchased}` : ""}
        {request.categoryName ? ` · ${request.categoryName}` : ""}
        {decided && request.approverName ? ` · Decided ${decided} by ${request.approverName}` : ""}
        {paid ? ` · Paid ${paid}` : ""}
      </p>
      {request.decisionNote ? (
        <p className="rb-meta rb-decision-note">
          {/* A reopened or resubmitted claim keeps the reason it was denied (the API no longer
              clears it), so both the filer and the next reviewer see what was wrong. */}
          {request.status === "denied" || ((request.status === "draft" || request.status === "submitted") && request.decidedAt)
            ? `Denied${decided ? ` ${decided}` : ""}: ${request.decisionNote}`
            : `Note: ${request.decisionNote}`}
        </p>
      ) : null}
      <p className="rb-meta">
        {request.hasReceipt ? (
          <a
            className="rb-receipt-link"
            href={`/api/reimbursements/${request.id}/receipt?orgId=${encodeURIComponent(orgId)}`}
            target="_blank"
            rel="noreferrer"
          >
            View receipt
            {request.receiptByteSize ? ` (${formatBytes(request.receiptByteSize)})` : ""}
          </a>
        ) : (
          <span className="rb-no-receipt">No receipt attached yet.</span>
        )}
      </p>
      <div className="rb-claim-actions">
        {canReplaceReceipt ? (
          <label className="rb-receipt-pick">
            {request.hasReceipt ? "Replace receipt" : "Add receipt"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onAttach(request.id, file);
                event.target.value = "";
              }}
            />
          </label>
        ) : null}
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={PRIMARY_ACTIONS.has(action) ? "primary" : undefined}
            disabled={busy}
            onClick={() => void onAct(request.id, action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </li>
  );
}
