"use client";

/**
 * Admin-only Link spend control. Posts one named finance expense + amount > 0
 * to POST /api/grants/allocations. Never copies a season-wide total.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Button } from "../../../components/ui";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NamedExpense = {
  id: string;
  label: string;
  amountUsd: number;
};

export type GrantApplicationOption = {
  id: string;
  label: string;
};

type LinkSpendFields = {
  orgId: string;
  grantApplicationId: string;
  financeTransactionId: string;
  amountUsd: unknown;
};

export type LinkSpendPayloadResult =
  | {
      ok: true;
      body: {
        orgId: string;
        grantApplicationId: string;
        financeTransactionId: string;
        amountUsd: number;
      };
    }
  | { ok: false; error: string };

function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function moneyLabel(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** Keep only real outbound ledger rows. Never sums, never uses a season total. */
export function namedExpensesFromLedger(ledger: unknown): NamedExpense[] {
  if (!Array.isArray(ledger)) return [];
  const named: NamedExpense[] = [];
  for (const row of ledger) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    if (entry.direction !== "out") continue;
    if (entry.mirrored === false) continue;
    const id = asUuid(entry.id);
    if (!id) continue;
    const amountUsd = Number(entry.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
    const rawLabel =
      (typeof entry.label === "string" && entry.label.trim()) ||
      (typeof entry.categoryName === "string" && entry.categoryName.trim()) ||
      "Named expense";
    named.push({
      id,
      label: rawLabel,
      amountUsd: Math.round(amountUsd * 100) / 100,
    });
  }
  return named;
}

export function grantApplicationOptions(rows: unknown): GrantApplicationOption[] {
  if (!Array.isArray(rows)) return [];
  const options: GrantApplicationOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const app = row as Record<string, unknown>;
    const id = asUuid(app.id);
    if (!id) continue;
    const name =
      (typeof app.opportunityName === "string" && app.opportunityName.trim()) ||
      (typeof app.summary === "string" && app.summary.trim()) ||
      "Grant application";
    const status = typeof app.status === "string" && app.status.trim() ? app.status.trim() : null;
    options.push({ id, label: status ? `${name} · ${status}` : name });
  }
  return options;
}

function parseAmountUsd(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  return rounded > 0 ? rounded : null;
}

/**
 * Build the allocations POST body from an explicit grant + named expense + amount.
 * seasonTotalUsd / copySeason / seasonExpensesUsd are ignored — never become the amount.
 */
export function buildLinkSpendPayload(input: LinkSpendFields & Record<string, unknown>): LinkSpendPayloadResult {
  const orgId = asUuid(input.orgId);
  const grantApplicationId = asUuid(input.grantApplicationId);
  const financeTransactionId = asUuid(input.financeTransactionId);
  if (!orgId) return { ok: false, error: "orgId is required" };
  if (!grantApplicationId) return { ok: false, error: "grantApplicationId is required" };
  if (!financeTransactionId) return { ok: false, error: "financeTransactionId is required" };
  if (input.amountUsd == null || input.amountUsd === "") {
    return { ok: false, error: "amountUsd is required" };
  }
  const amountUsd = parseAmountUsd(input.amountUsd);
  if (amountUsd == null) {
    return { ok: false, error: "amountUsd must be greater than 0" };
  }
  return {
    ok: true,
    body: { orgId, grantApplicationId, financeTransactionId, amountUsd },
  };
}

function businessGrantsHref(orgId: string): string {
  return `/business?${new URLSearchParams({ tab: "grants", orgId }).toString()}`;
}

function seasonFinanceHref(orgId: string): string {
  return `/business?${new URLSearchParams({ tab: "finance", orgId }).toString()}`;
}

export function AllocateSpend({ orgId, seasonYear }: { orgId: string; seasonYear?: number | null }) {
  const [applications, setApplications] = useState<GrantApplicationOption[]>([]);
  const [expenses, setExpenses] = useState<NamedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [grantApplicationId, setGrantApplicationId] = useState("");
  const [financeTransactionId, setFinanceTransactionId] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    setForbidden(false);
    const appQuery = new URLSearchParams({ orgId });
    if (seasonYear) appQuery.set("seasonYear", String(seasonYear));
    void Promise.all([
      fetch(`/api/grants/applications?${appQuery.toString()}`),
      fetch(`/api/finance/balance?${new URLSearchParams({ orgId }).toString()}`),
    ])
      .then(async ([appsResponse, balanceResponse]) => {
        if (appsResponse.status === 401 || appsResponse.status === 403) {
          setForbidden(true);
          setApplications([]);
          setExpenses([]);
          return;
        }
        const appsData = (await appsResponse.json()) as { applications?: unknown; error?: string };
        const balanceData = (await balanceResponse.json()) as {
          status?: string;
          ledger?: unknown;
          error?: string;
        };
        if (!appsResponse.ok) {
          setLoadError(appsData.error || "Could not load grant applications.");
          setApplications([]);
        } else {
          setApplications(grantApplicationOptions(appsData.applications));
        }
        if (!balanceResponse.ok || balanceData.status === "setup_required") {
          setExpenses([]);
        } else {
          setExpenses(namedExpensesFromLedger(balanceData.ledger));
        }
      })
      .catch(() => {
        setLoadError("Network error — please try again.");
        setApplications([]);
        setExpenses([]);
      })
      .finally(() => setLoading(false));
  }, [orgId, seasonYear]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedExpense = useMemo(
    () => expenses.find((row) => row.id === financeTransactionId) ?? null,
    [expenses, financeTransactionId],
  );

  function selectExpense(id: string) {
    setFinanceTransactionId(id);
    const expense = expenses.find((row) => row.id === id);
    if (expense && !amountUsd) {
      setAmountUsd(String(expense.amountUsd));
    }
    setError("");
    setNotice("");
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const parsed = buildLinkSpendPayload({
      orgId,
      grantApplicationId,
      financeTransactionId,
      amountUsd,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/grants/allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      const data = (await response.json()) as { error?: string; allocation?: unknown };
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        setError(data.error || "Organization administrator access required");
        return;
      }
      if (!response.ok) {
        setError(data.error || "Could not link spend.");
        return;
      }
      setNotice("Named expense linked to this grant.");
      setAmountUsd("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <section className="app-card soft-panel" aria-label="Link spend">
        <span className="eyebrow">Link spend</span>
        <EmptyState
          compact
          badge="Admins"
          title="Owner or admin required"
          description="Linking a named expense to a grant is an admin action. Ask a team owner or admin — season totals are never copied in."
        />
      </section>
    );
  }

  return (
    <section className="app-card soft-panel" aria-label="Link spend">
      <span className="eyebrow">Link spend</span>
      <h2>Attach a named expense</h2>
      <p className="app-muted">
        Admins link one recorded expense and an amount greater than 0. Grant reports count only these
        allocations — never a season spend total.
      </p>

      {loadError ? (
        <p className="telemetry-status" role="alert">
          {loadError}
        </p>
      ) : null}
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="telemetry-status" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <EmptyState compact title="Loading spend options…" aria-busy />
      ) : !applications.length ? (
        <EmptyState
          compact
          badge="Setup"
          badgeTone="setup"
          title="No grant applications yet"
          description="Add an application on the Business grants board first. Award and spend amounts stay blank until you record them."
        >
          <Button as="a" variant="secondary" href={businessGrantsHref(orgId)}>
            Open Business · Grants
          </Button>
        </EmptyState>
      ) : !expenses.length ? (
        <EmptyState
          compact
          badge="Setup"
          badgeTone="setup"
          title="No named expenses yet"
          description="Log a purchase or other spend first. There is nothing to allocate yet."
        >
          <Button as="a" variant="secondary" href={seasonFinanceHref(orgId)}>
            Open Season Finance
          </Button>
        </EmptyState>
      ) : (
        <form
          className="gwe-meta"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="gwe-field">
            <span>Grant application</span>
            <select
              required
              value={grantApplicationId}
              onChange={(event) => {
                setGrantApplicationId(event.target.value);
                setError("");
                setNotice("");
              }}
            >
              <option value="">Select a grant</option>
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.label}
                </option>
              ))}
            </select>
          </label>
          <label className="gwe-field">
            <span>Named expense</span>
            <select required value={financeTransactionId} onChange={(event) => selectExpense(event.target.value)}>
              <option value="">Select an expense</option>
              {expenses.map((expense) => (
                <option key={expense.id} value={expense.id}>
                  {expense.label} · {moneyLabel(expense.amountUsd)}
                </option>
              ))}
            </select>
            <small>Only this row’s recorded amount — not a season rollup.</small>
          </label>
          <label className="gwe-field">
            <span>Amount ($)</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amountUsd}
              onChange={(event) => setAmountUsd(event.target.value)}
              placeholder={selectedExpense ? String(selectedExpense.amountUsd) : "Amount greater than 0"}
            />
            <small>Must be greater than 0. Leave blank rather than inventing a season total.</small>
          </label>
          <div className="gwe-actions">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Linking…" : "Link spend"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
