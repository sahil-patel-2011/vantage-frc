"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, StatTile, Button } from "../../components/ui";
import {
  describeBudget,
  type BudgetView,
  type BudgetSummary,
} from "../../lib/budget/compute-budget";
import type { CapabilityGrant, OrgRole } from "../../lib/capabilities/org-capabilities";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Candidate = { userId: string; name: string; email: string; role: OrgRole };

type Payload = {
  view: BudgetView;
  canGrantAccess: boolean;
  grants: CapabilityGrant[];
  /** Owners and admins, who hold budget access without a grant row. */
  implicitHolders: Candidate[];
  candidates: Candidate[];
};

type Denied = { error: string; reason?: string };

function isBudgetPayload(value: unknown): value is Payload {
  if (!value || typeof value !== "object") return false;
  const status = (value as { view?: { status?: unknown } }).view?.status;
  return status === "setup_required" || status === "ready";
}

function budgetCacheOrg(data: Payload, orgHint: string): string {
  if (typeof data.view.orgId === "string" && data.view.orgId.trim()) return data.view.orgId;
  return orgHint;
}

async function persistBudgetSnapshot(
  orgHint: string,
  seasonHint: string,
  data: Payload,
): Promise<void> {
  const cacheOrg = budgetCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.view.seasonYear);
  try {
    await putFeatureSnapshot("budget", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("budget", "_", data, seasonHint || seasonKey);
  } catch {
    // Live season budget already painted; IndexedDB is best-effort.
  }
}

const money = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" });

/**
 * Every state's headline. `remainingUsd` is null only while no budget is set;
 * with a budget and nothing recorded it is the whole budget, with a note.
 */
function Headline({ summary }: { summary: BudgetSummary }) {
  const remaining =
    summary.remainingUsd == null ? "—" : money(summary.remainingUsd);
  return (
    <div className="budget-headline">
      <StatTile
        label="Season budget"
        value={summary.totalBudgetUsd == null ? "Not set" : money(summary.totalBudgetUsd)}
      />
      {/* Approved requests count from approval: "committed", the word Business and Orders use. */}
      <StatTile label="Committed" value={money(summary.recordedSpendUsd)} />
      <StatTile
        label="Remaining"
        value={remaining}
        footer={
          summary.remainingUsd == null ? (
            <span className="budget-note">Set a budget to see this</span>
          ) : summary.state === "budget_no_spend" ? (
            <span className="budget-note">No spending recorded yet</span>
          ) : null
        }
      />
    </div>
  );
}

export default function BudgetClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [denied, setDenied] = useState<Denied | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [budgetInput, setBudgetInput] = useState("");
  const [budgetNotes, setBudgetNotes] = useState("");
  /** Shown beside Save, with Undo: a budget change is easy to reverse, so it saves straight away. */
  const [budgetSaved, setBudgetSaved] = useState<
    { text: string; undo: { total: number | null; notes: string } | null } | null
  >(null);

  const [feeLabel, setFeeLabel] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDate, setFeeDate] = useState("");
  const [feeKind, setFeeKind] = useState<"registration" | "event_fee">("event_fee");
  const [feePaid, setFeePaid] = useState(false);
  const [confirmFee, setConfirmFee] = useState(false);

  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const payloadRef = useRef<Payload | null>(null);
  payloadRef.current = payload;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = params.get("season");
    const seasonHint =
      seasonQuery && Number.isFinite(Number(seasonQuery))
        ? String(Number(seasonQuery))
        : String(new Date().getFullYear());
    let hadCache = Boolean(payloadRef.current);
    try {
      const cached = await getFeatureSnapshot<Payload>("budget", orgHint || "_", seasonHint);
      if (!payloadRef.current && cached?.data && isBudgetPayload(cached.data)) {
        setPayload(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
        if (cached.data.view.status === "ready") {
          setBudgetInput(
            cached.data.view.budget.totalBudgetUsd == null
              ? ""
              : String(cached.data.view.budget.totalBudgetUsd),
          );
          setBudgetNotes(cached.data.view.budget.notes ?? "");
        }
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonHint) query.set("season", seasonHint);
      const response = await fetch(`/api/budget${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as Payload & Denied;
      if (response.status === 401 || response.status === 403) {
        setDenied({ error: data.error ?? "Could not load the budget.", reason: data.reason });
        setPayload(null);
        setFromCache(false);
        setCachedAt(null);
        return;
      }
      if (!response.ok || !isBudgetPayload(data)) {
        if (hadCache || payloadRef.current) {
          setFromCache(true);
          setError("Could not refresh Season budget. Showing the last copy on this device.");
          setDenied(null);
          setFetchFailed(false);
        } else {
          setDenied({ error: data.error ?? "Could not load the budget.", reason: data.reason });
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setDenied(null);
      setError("");
      setPayload(data);
      setFromCache(false);
      setCachedAt(null);
      if (data.view.status === "ready") {
        setBudgetInput(
          data.view.budget.totalBudgetUsd == null ? "" : String(data.view.budget.totalBudgetUsd),
        );
        setBudgetNotes(data.view.budget.notes ?? "");
      }
      await persistBudgetSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || payloadRef.current) {
        setFromCache(true);
        setError("Could not refresh Season budget. Showing the last copy on this device.");
        setDenied(null);
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/budget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as Payload & Denied;
      if (!response.ok || !isBudgetPayload(data)) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setPayload(data);
      setNotice(success);
      const orgHint = new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
      await persistBudgetSnapshot(orgHint, String(data.view.seasonYear), data);
      return true;
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (denied && !payload) {
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
        <OfflineBanner feature="Season budget" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={denied.reason === "not_budget_manager" ? "Mentors only" : "Not available"}
          badgeTone="setup"
          title={
            denied.reason === "not_budget_manager"
              ? "The budget is not open to you"
              : "Budget unavailable"
          }
          description={denied.error}
        >
          <p className="app-muted">
            You can still ask for a part — a request does not need budget access.
          </p>
          <Button as="a" variant="primary" href="/part-requests">
            Request a part
          </Button>
        </EmptyState>
      </main>
    );
  }

  if (!payload) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error || denied?.error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || denied?.error,
          },
        )
      : null;
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
        <OfflineBanner feature="Season budget" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading season budget…"}
          description={failure ? failure.description : undefined}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const view = payload.view;

  if (view.status === "setup_required") {
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
        <OfflineBanner feature="Season budget" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description={view.message}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  const summary = view.summary;
  const feesPaid = view.competitionFees.find((line) => line.status === "paid");
  const feesPlanned = view.competitionFees.find((line) => line.status === "planned");
  const pending = view.openPartRequests.find((line) => line.status === "pending");

  return (
    <main className="module-page budget-page">
      <PageHeader
        breadcrumbs="Business / Money"
        title={`Season budget ${view.seasonYear}`}
        description={`The one budget number for ${view.orgName}. Money, orders and the Business overview all use it.`}
      />
      <OfflineBanner feature="Season budget" fromCache={fromCache} cachedAt={cachedAt} />

      <Panel>
        <h2>Where the season stands</h2>
        <Headline summary={summary} />
        <p className="budget-verdict">{describeBudget(summary)}</p>
        {/* One sentence on who can see this, not a panel and a contradiction. */}
        <p className="app-muted budget-who-line">
          Only owners, mentors and people you give budget access can see this page. You are
          here as{" "}
          <Badge tone="info">
            {view.accessVia === "owner"
              ? "Owner"
              : view.accessVia === "admin"
                ? "Mentor or coach"
                : "Budget access"}
          </Badge>
          .
        </p>
      </Panel>

      <Panel>
        <h2>Set the budget</h2>
        <p className="app-muted">
          One total for the {view.seasonYear} season. Clearing it removes the target; it never
          changes a single recorded dollar.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const previous = {
              total: view.budget.totalBudgetUsd,
              notes: view.budget.notes ?? "",
            };
            const nextTotal = budgetInput.trim() === "" ? null : budgetInput;
            setBudgetSaved(null);
            void act(
              {
                action: "set-budget",
                seasonYear: view.seasonYear,
                totalBudgetUsd: nextTotal,
                notes: budgetNotes,
              },
              "",
            ).then((ok) => {
              if (!ok) return;
              setBudgetSaved({
                text:
                  nextTotal == null
                    ? `Saved. The ${view.seasonYear} budget is cleared.`
                    : `Saved. The ${view.seasonYear} budget is ${money(Number(nextTotal) || 0)}.`,
                undo: previous,
              });
            });
          }}
        >
          <label className="budget-field">
            <span>Total budget (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={budgetInput}
              placeholder="e.g. 5000"
              onChange={(event) => {
                setBudgetInput(event.target.value);
                setBudgetSaved(null);
              }}
            />
          </label>
          <label className="budget-field">
            <span>Notes (optional)</span>
            <input
              type="text"
              value={budgetNotes}
              maxLength={500}
              onChange={(event) => {
                setBudgetNotes(event.target.value);
                setBudgetSaved(null);
              }}
            />
          </label>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save budget"}
          </Button>
          {budgetSaved ? (
            <p className="budget-saved" role="status">
              <span>{budgetSaved.text}</span>
              {budgetSaved.undo ? (
                <Button
                  variant="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const undo = budgetSaved.undo;
                    if (!undo) return;
                    void act(
                      {
                        action: "set-budget",
                        seasonYear: view.seasonYear,
                        totalBudgetUsd: undo.total,
                        notes: undo.notes,
                      },
                      "",
                    ).then((ok) => {
                      if (!ok) return;
                      setBudgetInput(undo.total == null ? "" : String(undo.total));
                      setBudgetNotes(undo.notes);
                      setBudgetSaved({
                        text:
                          undo.total == null
                            ? "Undone. No budget is set."
                            : `Undone. The budget is back to ${money(undo.total)}.`,
                        undo: null,
                      });
                    });
                  }}
                >
                  Undo
                </Button>
              ) : null}
            </p>
          ) : null}
        </form>
      </Panel>

      <Panel>
        <h2>Committed so far</h2>
        <p className="app-muted">Approved part requests count from the moment they are approved; paid event fees too.</p>
        {view.spendBySource.length === 0 ? (
          <EmptyState
            compact
            title="Nothing spent yet"
            description="Approved part requests and paid event fees show up here on their own."
          />
        ) : (
          <table className="budget-table">
            <thead>
              <tr>
                <th>Where it came from</th>
                <th className="num">Entries</th>
                <th className="num">Committed</th>
              </tr>
            </thead>
            <tbody>
              {view.spendBySource.map((line) => (
                <tr key={line.source}>
                  <td>{line.label}</td>
                  <td className="num">{line.rowCount}</td>
                  <td className="num">{money(line.outUsd)}</td>
                </tr>
              ))}
              <tr className="budget-total-row">
                <td>Total recorded</td>
                <td className="num">
                  {view.spendBySource.reduce((sum, line) => sum + line.rowCount, 0)}
                </td>
                <td className="num">{money(summary.recordedSpendUsd)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="app-muted">
          Ordered parts appear here as <strong>Order</strong> the moment a request is approved, and
          competition fees appear as <strong>Season cost</strong> once marked paid. Both are the
          same dollars the total above subtracts.
        </p>
      </Panel>

      <Panel>
        <h2>Competition fees</h2>
        <p className="app-muted">
          Registration and event fees are part of this budget, not a separate pot. Recording one
          here writes it to Season costs and, when it is marked paid, into the spend total above.
        </p>
        <ul className="budget-inline-facts">
          <li>
            Paid: <strong>{feesPaid ? money(feesPaid.amountUsd) : money(0)}</strong>{" "}
            <span className="app-muted">({feesPaid?.rowCount ?? 0} recorded)</span>
          </li>
          <li>
            Planned, not yet paid:{" "}
            <strong>{feesPlanned ? money(feesPlanned.amountUsd) : money(0)}</strong>{" "}
            <span className="app-muted">
              ({feesPlanned?.rowCount ?? 0} recorded — not counted as spend)
            </span>
          </li>
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!feeLabel.trim() || !feeAmount.trim() || !feeDate.trim()) {
              setError("Name the event, the amount, and the date before saving a fee.");
              return;
            }
            if (!confirmFee) {
              setConfirmFee(true);
              return;
            }
            void act(
              {
                action: "record-competition-fee",
                seasonYear: view.seasonYear,
                label: feeLabel,
                amountUsd: feeAmount,
                incurredOn: feeDate,
                kind: feeKind,
                paid: feePaid,
              },
              "Competition fee recorded.",
            ).then((ok) => {
              setConfirmFee(false);
              if (ok) {
                setFeeLabel("");
                setFeeAmount("");
                setFeeDate("");
                setFeePaid(false);
              }
            });
          }}
        >
          <label className="budget-field">
            <span>Event or registration</span>
            <input
              type="text"
              value={feeLabel}
              maxLength={200}
              placeholder="e.g. Week 3 district event"
              onChange={(event) => {
                setFeeLabel(event.target.value);
                setConfirmFee(false);
              }}
            />
          </label>
          <label className="budget-field">
            <span>Amount (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={feeAmount}
              onChange={(event) => {
                setFeeAmount(event.target.value);
                setConfirmFee(false);
              }}
            />
          </label>
          <label className="budget-field">
            <span>Date charged</span>
            <input
              type="date"
              value={feeDate}
              onChange={(event) => {
                setFeeDate(event.target.value);
                setConfirmFee(false);
              }}
            />
          </label>
          <label className="budget-field">
            <span>Kind</span>
            <select
              value={feeKind}
              onChange={(event) => {
                setFeeKind(event.target.value === "registration" ? "registration" : "event_fee");
                setConfirmFee(false);
              }}
            >
              <option value="event_fee">Event fee</option>
              <option value="registration">Season registration</option>
            </select>
          </label>
          <label className="budget-check">
            <input
              type="checkbox"
              checked={feePaid}
              onChange={(event) => {
                setFeePaid(event.target.checked);
                setConfirmFee(false);
              }}
            />
            <span>Already paid (counts as spend now)</span>
          </label>
          {confirmFee ? (
            <p className="budget-confirm">
              Record {money(Number(feeAmount) || 0)} for &ldquo;{feeLabel}&rdquo;
              {feePaid ? " as money already spent" : " as a planned fee"}?{" "}
              <Button variant="primary" type="submit" disabled={busy}>
                Yes, record it
              </Button>{" "}
              <Button variant="ghost" type="button" onClick={() => setConfirmFee(false)}>
                Cancel
              </Button>
            </p>
          ) : (
            <div>
              <Button variant="secondary" type="submit" disabled={busy}>
                Record fee
              </Button>
            </div>
          )}
        </form>
      </Panel>

      <Panel>
        <h2>Waiting on you</h2>
        {pending && pending.rowCount > 0 ? (
          <p>
            <strong>{pending.rowCount}</strong> part request
            {pending.rowCount === 1 ? "" : "s"} totalling{" "}
            <strong>{money(pending.amountUsd)}</strong> {pending.rowCount === 1 ? "is" : "are"}{" "}
            waiting for a decision. None of it counts as spend until it is approved.{" "}
            <a href="/part-requests">Open part requests</a>
          </p>
        ) : (
          <p className="app-muted">
            No part requests are waiting. <a href="/part-requests">Part requests</a>
          </p>
        )}
      </Panel>

      {payload.canGrantAccess ? (
        <Panel>
          <h2>Who else can see the budget</h2>
          {/* Budget access is set per person in one place: Team admin → Access. */}
          <p className="app-muted">
            {payload.grants.length === 0
              ? "Only owners and mentors can see it right now."
              : `Also open to: ${payload.grants.map((grant) => grant.name || grant.email).join(", ")}.`}{" "}
            To let someone else see it, open their <strong>Access</strong> on Team admin.
          </p>
          <div>
            <Button
              as="a"
              variant="secondary"
              href={`/team/admin?orgId=${encodeURIComponent(view.orgId)}#people`}
            >
              Choose who can see it
            </Button>
          </div>
        </Panel>
      ) : null}

      {error ? <p className="budget-error">{error}</p> : null}
      {notice ? <p className="budget-notice" role="status">{notice}</p> : null}
    </main>
  );
}
