import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECEIPT_BYTES,
  REIMBURSEMENT_LIST_SQL,
  REIMBURSEMENT_STATUSES,
  auditPayload,
  availableActions,
  currentSeasonYear,
  evaluateReceiptUpload,
  evaluateTransition,
  formatBytes,
  isReimbursementAction,
  isReimbursementStatus,
  isUuid,
  mapSummaryRow,
  mirrorLabel,
  normalizeClaimDraft,
  summarizeReimbursements,
  syncReimbursementMirror,
  writeReimbursementAudit,
  type ReimbursementSummary,
} from "./reimbursements";

function claim(overrides: Partial<ReimbursementSummary> = {}): ReimbursementSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    seasonYear: 2026,
    memberUserId: "22222222-2222-4222-8222-222222222222",
    memberName: "Dana Patel",
    amountUsd: 180,
    description: "Gearbox",
    categoryId: null,
    categoryName: null,
    purchasedOn: "2026-02-04",
    status: "submitted",
    decisionNote: null,
    approverName: null,
    submittedAt: "2026-02-05T00:00:00Z",
    decidedAt: null,
    paidAt: null,
    hasReceipt: true,
    receiptByteSize: 1024,
    receiptChecksum: "a".repeat(64),
    createdAt: "2026-02-04T00:00:00Z",
    updatedAt: "2026-02-05T00:00:00Z",
    ...overrides,
  };
}

describe("reimbursement statuses", () => {
  it("recognises exactly the five lifecycle states", () => {
    expect([...REIMBURSEMENT_STATUSES]).toEqual(["draft", "submitted", "approved", "denied", "paid"]);
    expect(isReimbursementStatus("paid")).toBe(true);
    expect(isReimbursementStatus("reimbursed")).toBe(false);
    expect(isReimbursementStatus(null)).toBe(false);
  });

  it("recognises only the declared actions", () => {
    expect(isReimbursementAction("mark_paid")).toBe(true);
    expect(isReimbursementAction("delete")).toBe(false);
    expect(isReimbursementAction("toString")).toBe(false);
  });
});

describe("evaluateTransition", () => {
  const base = { actor: "admin" as const, isOwnClaim: false, hasReceipt: true };

  it("lets a member submit their own draft once a receipt is attached", () => {
    expect(
      evaluateTransition({ action: "submit", from: "draft", actor: "member", isOwnClaim: true, hasReceipt: true }),
    ).toEqual({ ok: true, to: "submitted", audit: "reimbursement.submitted" });
  });

  it("blocks submitting without a receipt — the top reason claims bounce", () => {
    const verdict = evaluateTransition({
      action: "submit",
      from: "draft",
      actor: "member",
      isOwnClaim: true,
      hasReceipt: false,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/receipt/i);
  });

  it("refuses to let a member approve or pay anything", () => {
    for (const action of ["approve", "mark_paid", "deny"] as const) {
      const verdict = evaluateTransition({
        action,
        from: action === "mark_paid" ? "approved" : "submitted",
        actor: "member",
        isOwnClaim: true,
        hasReceipt: true,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toMatch(/owner or admin/i);
    }
  });

  it("refuses a member acting on someone else's claim", () => {
    const verdict = evaluateTransition({
      action: "submit",
      from: "draft",
      actor: "member",
      isOwnClaim: false,
      hasReceipt: true,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/only change reimbursements you filed/i);
  });

  it("only allows payment from the approved state", () => {
    expect(evaluateTransition({ ...base, action: "mark_paid", from: "approved" }).ok).toBe(true);
    expect(evaluateTransition({ ...base, action: "mark_paid", from: "submitted" }).ok).toBe(false);
    expect(evaluateTransition({ ...base, action: "mark_paid", from: "denied" }).ok).toBe(false);
  });

  it("allows an admin to undo a payment back to approved", () => {
    expect(evaluateTransition({ ...base, action: "unmark_paid", from: "paid" })).toEqual({
      ok: true,
      to: "approved",
      audit: "reimbursement.payment_undone",
    });
  });

  it("lets a denied claim be fixed and resubmitted", () => {
    expect(
      evaluateTransition({ action: "submit", from: "denied", actor: "member", isOwnClaim: true, hasReceipt: true }).ok,
    ).toBe(true);
    expect(
      evaluateTransition({ action: "reopen", from: "denied", actor: "member", isOwnClaim: true, hasReceipt: false }).ok,
    ).toBe(true);
  });

  it("never offers a paid claim anything but undoing the payment", () => {
    expect(availableActions({ status: "paid", actor: "admin", isOwnClaim: false, hasReceipt: true })).toEqual([
      "unmark_paid",
    ]);
  });

  it("offers a member nothing on a claim already decided", () => {
    expect(availableActions({ status: "approved", actor: "member", isOwnClaim: true, hasReceipt: true })).toEqual([]);
    expect(availableActions({ status: "paid", actor: "member", isOwnClaim: true, hasReceipt: true })).toEqual([]);
  });

  it("orders the treasurer's queue actions decision-first", () => {
    expect(availableActions({ status: "submitted", actor: "admin", isOwnClaim: false, hasReceipt: true })).toEqual([
      "approve",
      "deny",
      "withdraw",
    ]);
  });
});

describe("evaluateReceiptUpload", () => {
  it("accepts phone camera stills", () => {
    expect(evaluateReceiptUpload({ mediaType: "image/jpeg", byteSize: 900_000 })).toEqual({
      ok: true,
      mediaType: "image/jpeg",
    });
  });

  it("rejects non-image and empty uploads", () => {
    expect(evaluateReceiptUpload({ mediaType: "application/pdf", byteSize: 10 }).ok).toBe(false);
    expect(evaluateReceiptUpload({ mediaType: null, byteSize: 10 }).ok).toBe(false);
    expect(evaluateReceiptUpload({ mediaType: "image/png", byteSize: 0 }).ok).toBe(false);
  });

  it("names the actual size when over the cap", () => {
    const verdict = evaluateReceiptUpload({ mediaType: "image/jpeg", byteSize: MAX_RECEIPT_BYTES + 1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("3.0 MB");
  });

  it("formats sizes without inventing precision", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("normalizeClaimDraft", () => {
  it("rounds to whole cents and keeps the trimmed description", () => {
    const result = normalizeClaimDraft({ amountUsd: "180.005", description: "  Gearbox  ", seasonYear: 2026 });
    expect(result).toEqual({
      ok: true,
      value: { amountUsd: 180.01, description: "Gearbox", categoryId: null, purchasedOn: null, seasonYear: 2026 },
    });
  });

  it("refuses zero, negative, and non-numeric amounts", () => {
    expect(normalizeClaimDraft({ amountUsd: 0, description: "x" }).ok).toBe(false);
    expect(normalizeClaimDraft({ amountUsd: -5, description: "x" }).ok).toBe(false);
    expect(normalizeClaimDraft({ amountUsd: "abc", description: "x" }).ok).toBe(false);
  });

  it("requires a description", () => {
    const verdict = normalizeClaimDraft({ amountUsd: 10, description: "   " });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/spent on/i);
  });

  it("drops a non-uuid category rather than guessing one", () => {
    const result = normalizeClaimDraft({ amountUsd: 10, description: "x", categoryId: "travel" });
    expect(result.ok && result.value.categoryId).toBeNull();
  });

  it("rejects a malformed purchase date instead of coercing it", () => {
    expect(normalizeClaimDraft({ amountUsd: 10, description: "x", purchasedOn: "02/04/2026" }).ok).toBe(false);
    expect(normalizeClaimDraft({ amountUsd: 10, description: "x", purchasedOn: "2026-13-40" }).ok).toBe(false);
  });

  it("falls back to the current season when none is given", () => {
    const now = new Date("2026-08-24T00:00:00Z");
    const result = normalizeClaimDraft({ amountUsd: 10, description: "x", now });
    expect(result.ok && result.value.seasonYear).toBe(currentSeasonYear(now));
  });
});

describe("summarizeReimbursements", () => {
  it("splits the queue into waiting, owed, and actually paid", () => {
    const totals = summarizeReimbursements([
      claim({ status: "submitted", amountUsd: 180 }),
      claim({ status: "submitted", amountUsd: 20.5 }),
      claim({ status: "approved", amountUsd: 42 }),
      claim({ status: "paid", amountUsd: 300 }),
      claim({ status: "draft", amountUsd: 999 }),
      claim({ status: "denied", amountUsd: 999 }),
    ]);
    expect(totals).toEqual({
      awaitingDecisionUsd: 200.5,
      awaitingDecisionCount: 2,
      approvedUnpaidUsd: 42,
      approvedUnpaidCount: 1,
      paidUsd: 300,
      paidCount: 1,
    });
  });

  it("reports zeros for an empty queue rather than a placeholder", () => {
    expect(summarizeReimbursements([])).toEqual({
      awaitingDecisionUsd: 0,
      awaitingDecisionCount: 0,
      approvedUnpaidUsd: 0,
      approvedUnpaidCount: 0,
      paidUsd: 0,
      paidCount: 0,
    });
  });
});

describe("row mapping", () => {
  it("parses numeric(12,2) text into cent-accurate dollars", () => {
    const mapped = mapSummaryRow({ ...claim(), amountUsd: "180.55" } as never);
    expect(mapped.amountUsd).toBe(180.55);
  });

  it("falls back to draft for an unrecognised status", () => {
    expect(mapSummaryRow({ ...claim(), status: "weird" } as never).status).toBe("draft");
  });

  it("never selects the receipt bytes in the list query", () => {
    expect(REIMBURSEMENT_LIST_SQL).not.toMatch(/receipt_bytes(?!\s+IS\s+NOT\s+NULL)/);
    expect(REIMBURSEMENT_LIST_SQL).toContain("$1::uuid");
  });
});

describe("ledger mirror", () => {
  it("keeps the member's name out of the org-readable ledger label", () => {
    expect(mirrorLabel({ description: "Gearbox" })).toBe("Reimbursement — Gearbox");
    expect(mirrorLabel({ description: "Gearbox" })).not.toContain("Dana");
  });

  it("mirrors a paid claim as cash out on source_kind 'reimbursement'", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await syncReimbursementMirror({ query } as never, {
      orgId: "33333333-3333-4333-8333-333333333333",
      reimbursementId: "11111111-1111-4111-8111-111111111111",
      status: "paid",
      amountUsd: 180,
      seasonYear: 2026,
      categoryId: null,
      description: "Gearbox",
      paidAt: "2026-02-09T00:00:00Z",
      actorUserId: "44444444-4444-4444-8444-444444444444",
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT (org_id, source_kind, source_id)");
    expect(params).toContain("reimbursement");
    expect(params).toContain(180);
  });

  it("removes the mirror whenever the claim is not paid, so undoing a payment cannot leave money behind", async () => {
    for (const status of ["draft", "submitted", "approved", "denied"] as const) {
      const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
      await syncReimbursementMirror({ query } as never, {
        orgId: "33333333-3333-4333-8333-333333333333",
        reimbursementId: "11111111-1111-4111-8111-111111111111",
        status,
        amountUsd: 180,
        seasonYear: 2026,
        categoryId: null,
        description: "Gearbox",
        paidAt: null,
        actorUserId: "44444444-4444-4444-8444-444444444444",
      });
      const [sql] = query.mock.calls[0]!;
      expect(sql).toContain("DELETE FROM finance_transactions");
    }
  });
});

describe("audit trail", () => {
  it("logs only the claim id, status, and amount — never the description or filer", () => {
    expect(auditPayload({ reimbursementId: "abc", status: "paid", amountUsd: 180.005 })).toEqual({
      reimbursementId: "abc",
      status: "paid",
      amountUsd: 180.01,
    });
  });

  it("writes a parameterized finance_audit_log row", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await writeReimbursementAudit({ query } as never, {
      orgId: "33333333-3333-4333-8333-333333333333",
      actorUserId: "44444444-4444-4444-8444-444444444444",
      action: "reimbursement.paid",
      before: null,
      after: auditPayload({ reimbursementId: "abc", status: "paid", amountUsd: 12 }),
    });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO finance_audit_log");
    expect(sql).toContain("$5::jsonb");
    // Members may only append reimbursement.* actions (0482 RLS policy).
    expect(params[2]).toMatch(/^reimbursement\./);
    expect(params[3]).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts a real uuid and rejects injection-shaped input", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111' OR 1=1--")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
