"use client";

/**
 * Reimbursements — the surface a treasurer-parent actually opens.
 *
 * Three jobs, top to bottom:
 *  1. File a claim: amount, what it was for, and a photo of the receipt. The
 *     photo is downscaled IN THE BROWSER before upload (the pure geometry maths
 *     are imported read-only from lib/scouting/media-downscale.ts) so a 12 MP
 *     phone shot lands under the server cap instead of being rejected on a
 *     venue's hotel wifi.
 *  2. Work the queue: approve, deny, mark paid. Only an owner/admin sees those
 *     buttons, and only a PAID claim moves the team's balance.
 *  3. "Season money at a glance": budget versus actual by category, and the
 *     one-file season financial report a treasurer hands to next year's.
 *
 * Honesty rules: no number on this page is estimated. A category with no budget
 * says so instead of showing a percentage; an empty queue shows zeros; a failed
 * load shows the real message with a retry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import {
  BUDGET_CLOSE_RATIO,
  describeBudgetLine,
  type BudgetLine,
  type BudgetVsActualView,
} from "../../lib/finance/budget-vs-actual";
import {
  MAX_RECEIPT_BYTES,
  REIMBURSEMENT_STATUS_HINTS,
  REIMBURSEMENT_STATUS_LABELS,
  availableActions,
  evaluateReceiptUpload,
  formatBytes,
  type ReimbursementAction,
  type ReimbursementSummary,
  type ReimbursementsView,
} from "../../lib/finance/reimbursements";
import {
  DOWNSCALE_JPEG_QUALITY,
  downscaleDimensions,
} from "../../lib/scouting/media-downscale";
import { withOrgHref } from "../../lib/nav/product-nav";
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

/** Actions that read as the obvious next step get the filled treatment. */
const PRIMARY_ACTIONS = new Set<ReimbursementAction>(["submit", "approve", "mark_paid"]);

function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Re-encode a phone photo down to the shared max edge before upload.
 *
 * The geometry and quality constants come from lib/scouting/media-downscale.ts
 * (imported, not copied) — the canvas work has to live here because that module
 * is deliberately DOM-free so it stays unit-testable in node. On any failure the
 * original file is returned unchanged and the server cap does the rejecting.
 */
async function downscaleReceipt(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height, scaled } = downscaleDimensions(bitmap.width, bitmap.height);
      if (!scaled && file.size <= MAX_RECEIPT_BYTES) return file;
      if (width < 1 || height < 1) return file;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      const encoded = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", DOWNSCALE_JPEG_QUALITY),
      );
      if (!encoded || encoded.size === 0) return file;
      return encoded.size < file.size ? encoded : file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

type Status = "loading" | "ready" | "error";

export default function ReimbursementsClient() {
  const [view, setView] = useState<ReimbursementsView | null>(null);
  const [budget, setBudget] = useState<BudgetVsActualView | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purchasedOn, setPurchasedOn] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const receiptInput = useRef<HTMLInputElement | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const urlOrg = params.get("orgId");
    const query = urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : "";
    setStatus("loading");
    fetch(`/api/reimbursements${query}`)
      .then((response) => response.json() as Promise<ReimbursementsView>)
      .then((next) => {
        setView(next);
        setStatus("ready");
        setError(null);
        if (next.status !== "ready") return null;
        return fetch(
          `/api/finance/budget-vs-actual?orgId=${encodeURIComponent(next.orgId)}&seasonYear=${next.seasonYear}`,
        )
          .then((response) => response.json() as Promise<BudgetVsActualView>)
          .then(setBudget)
          .catch(() => setBudget(null));
      })
      .catch((cause: unknown) => {
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "Could not load reimbursements.");
      });
  }, []);

  useEffect(load, [load]);

  const pickReceipt = useCallback((file: File | null) => {
    setNotice(null);
    if (!file) {
      setReceipt(null);
      return;
    }
    const verdict = evaluateReceiptUpload({ mediaType: file.type, byteSize: file.size });
    // Only the TYPE is refused up front — an oversized photo is still accepted
    // here because the browser downscale below usually brings it under the cap.
    if (!verdict.ok && !/limit/i.test(verdict.reason)) {
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
        const prepared = await downscaleReceipt(receipt);
        const verdict = evaluateReceiptUpload({ mediaType: prepared.type, byteSize: prepared.size });
        if (!verdict.ok) throw new Error(verdict.reason);
        const form = new FormData();
        form.set("orgId", orgId);
        form.set("receipt", prepared, receipt.name || "receipt.jpg");
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
          : "Saved as a draft. Attach the receipt photo, then submit it.",
      );
      load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not file that reimbursement.");
    } finally {
      setBusy(false);
    }
  }, [orgId, busy, amount, description, categoryId, purchasedOn, receipt, view, load]);

  const act = useCallback(
    async (id: string, action: ReimbursementAction) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      let note: string | null = null;
      if (action === "deny" && typeof window !== "undefined") {
        note = window.prompt("Why is this being denied? The filer sees this note.")?.trim() || null;
      }
      try {
        const response = await fetch(`/api/reimbursements/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, action, decisionNote: note }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not update that reimbursement.");
        setNotice(
          action === "mark_paid"
            ? "Marked paid and recorded in the team ledger."
            : `${ACTION_LABELS[action]} — done.`,
        );
        load();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Could not update that reimbursement.");
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
        const prepared = await downscaleReceipt(file);
        const verdict = evaluateReceiptUpload({ mediaType: prepared.type, byteSize: prepared.size });
        if (!verdict.ok) throw new Error(verdict.reason);
        const form = new FormData();
        form.set("orgId", orgId);
        form.set("receipt", prepared, file.name || "receipt.jpg");
        const response = await fetch(`/api/reimbursements/${id}/receipt`, { method: "POST", body: form });
        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(failure?.error ?? "Could not attach that receipt.");
        }
        setNotice("Receipt attached.");
        load();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Could not attach that receipt.");
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

      {status === "loading" ? <EmptyState title="Loading reimbursements…" aria-busy /> : null}

      {status === "error" ? (
        <EmptyState
          title="Could not load reimbursements"
          description={error ?? "Something went wrong."}
        >
          <button type="button" className="rb-receipt-pick" onClick={load}>
            Retry
          </button>
        </EmptyState>
      ) : null}

      {view && view.status === "setup_required" ? (
        <EmptyState title="Not set up yet" badge="Setup" badgeTone="setup" description={view.message} />
      ) : null}

      {ready ? (
        <>
          <dl className="rb-totals">
            <div className="rb-total">
              <dt>Waiting on the treasurer</dt>
              <dd>{money(ready.totals.awaitingDecisionUsd)}</dd>
              <small>
                {ready.totals.awaitingDecisionCount} claim
                {ready.totals.awaitingDecisionCount === 1 ? "" : "s"} submitted
              </small>
            </div>
            <div className="rb-total">
              <dt>Approved, not paid yet</dt>
              <dd>{money(ready.totals.approvedUnpaidUsd)}</dd>
              <small>Owed to families — not counted against the balance until paid</small>
            </div>
            <div className="rb-total">
              <dt>Paid back this season</dt>
              <dd>{money(ready.totals.paidUsd)}</dd>
              <small>
                {ready.totals.paidCount} claim{ready.totals.paidCount === 1 ? "" : "s"} in the team ledger
              </small>
            </div>
          </dl>

          <Panel>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>File a claim</h2>
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
                  {receipt ? `Receipt: ${receipt.name} (${formatBytes(receipt.size)})` : "Add receipt photo"}
                  <input
                    ref={receiptInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
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
                Photos are shrunk on your phone before they upload, so a normal camera shot fits under the{" "}
                {formatBytes(MAX_RECEIPT_BYTES)} limit. A claim needs a receipt before it can be submitted.
              </p>
            </div>
          </Panel>

          <Panel>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>
              {ready.isTreasurer ? "Every claim on the team" : "Your claims"}
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

          <Panel>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Season money at a glance</h2>
            <p className="rb-meta" style={{ marginBottom: 12 }}>
              Every budget category for {ready.seasonYear}, against what the unified ledger says was actually
              spent — orders, receipts, paid season costs, and paid reimbursements.
            </p>
            {budget && budget.status === "setup_required" ? (
              <EmptyState soft title="Not available yet" description={budget.message} />
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
        {REIMBURSEMENT_STATUS_HINTS[request.status]}
        {isTreasurer && request.memberName ? ` · Filed by ${request.memberName}` : ""}
        {purchased ? ` · Purchased ${purchased}` : ""}
        {request.categoryName ? ` · ${request.categoryName}` : ""}
        {decided && request.approverName ? ` · Decided ${decided} by ${request.approverName}` : ""}
        {paid ? ` · Paid ${paid}` : ""}
      </p>
      {request.decisionNote ? <p className="rb-meta">Note: {request.decisionNote}</p> : null}
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
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
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
