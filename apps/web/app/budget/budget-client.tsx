"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel, StatTile, Button } from "../../components/ui";
import {
  describeBudget,
  type BudgetView,
  type BudgetSummary,
} from "../../lib/budget/compute-budget";
import type { CapabilityGrant, OrgRole } from "../../lib/capabilities/org-capabilities";

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

const money = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" });

/**
 * Every state's headline. `remainingUsd` is null in three of the five states and
 * this renders a dash for it — a dash a mentor has to ask about is better than a
 * number that flatters.
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
      <StatTile label="Recorded spend" value={money(summary.recordedSpendUsd)} />
      <StatTile
        label="Remaining"
        value={remaining}
        footer={
          summary.remainingUsd == null ? (
            <span className="budget-note">Not shown — see the line below</span>
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
  const [confirmBudget, setConfirmBudget] = useState(false);

  const [feeLabel, setFeeLabel] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [feeDate, setFeeDate] = useState("");
  const [feeKind, setFeeKind] = useState<"registration" | "event_fee">("event_fee");
  const [feePaid, setFeePaid] = useState(false);
  const [confirmFee, setConfirmFee] = useState(false);

  const [grantUserId, setGrantUserId] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/budget");
      const data = (await response.json()) as Payload & Denied;
      if (!response.ok) {
        setDenied({ error: data.error ?? "Could not load the budget.", reason: data.reason });
        setPayload(null);
        return;
      }
      setDenied(null);
      setPayload(data);
      if (data.view.status === "ready") {
        setBudgetInput(
          data.view.budget.totalBudgetUsd == null ? "" : String(data.view.budget.totalBudgetUsd),
        );
        setBudgetNotes(data.view.budget.notes ?? "");
      }
    } catch {
      setDenied({ error: "Could not reach the server." });
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
      });
      const data = (await response.json()) as Payload & Denied;
      if (!response.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setPayload(data);
      setNotice(success);
      return true;
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (denied) {
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
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
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
        <Panel>
          <p className="app-muted">Loading…</p>
        </Panel>
      </main>
    );
  }

  const view = payload.view;

  if (view.status === "setup_required") {
    return (
      <main className="module-page budget-page">
        <PageHeader breadcrumbs="Business / Money" title="Season budget" />
        <EmptyState soft badge="Setup" badgeTone="setup" title="Not migrated yet" description={view.message} />
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
        description={`${view.orgName} — visible to mentors only.`}
      />

      {/*
        The brief said to say this plainly rather than let anyone believe a
        "mentor" permission exists. It does not: this is the Owner/Admin role
        plus an explicit grant.
      */}
      <Panel className="budget-who">
        <h2>Who can see this</h2>
        <p>
          Vantage has no separate <strong>mentor</strong> permission. Budget access is the team{" "}
          <strong>Owner</strong> and <strong>Admin</strong> roles, plus anyone an owner has
          explicitly granted budget access below. The adult/student field on a profile is
          descriptive only — anyone can set it on themselves, so it grants nothing.
        </p>
        <p className="app-muted">
          You are seeing this page as:{" "}
          <Badge tone="info">
            {view.accessVia === "owner"
              ? "Owner"
              : view.accessVia === "admin"
                ? "Admin"
                : "Granted budget access"}
          </Badge>
        </p>
      </Panel>

      <Panel>
        <h2>Where the season stands</h2>
        <Headline summary={summary} />
        <p className="budget-verdict">{describeBudget(summary)}</p>
        {summary.state === "budget_no_spend" ? (
          <p className="budget-warn">
            Nothing has been recorded against this budget yet. That is a statement about the
            records, not about the money — until spending is entered, there is no honest
            &ldquo;remaining&rdquo; figure to show.
          </p>
        ) : null}
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
            if (!confirmBudget) {
              setConfirmBudget(true);
              return;
            }
            void act(
              {
                action: "set-budget",
                seasonYear: view.seasonYear,
                totalBudgetUsd: budgetInput.trim() === "" ? null : budgetInput,
                notes: budgetNotes,
              },
              "Budget saved.",
            ).then(() => setConfirmBudget(false));
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
              placeholder="Leave blank for no budget"
              onChange={(event) => {
                setBudgetInput(event.target.value);
                setConfirmBudget(false);
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
                setConfirmBudget(false);
              }}
            />
          </label>
          {confirmBudget ? (
            <p className="budget-confirm">
              {budgetInput.trim() === ""
                ? "Clear the season budget?"
                : `Set the ${view.seasonYear} budget to ${money(Number(budgetInput) || 0)}?`}{" "}
              <Button variant="primary" type="submit" disabled={busy}>
                Yes, save it
              </Button>{" "}
              <Button variant="ghost" type="button" onClick={() => setConfirmBudget(false)}>
                Cancel
              </Button>
            </p>
          ) : (
            <Button variant="primary" type="submit" disabled={busy}>
              Save budget
            </Button>
          )}
        </form>
      </Panel>

      <Panel>
        <h2>What has actually been spent</h2>
        {view.spendBySource.length === 0 ? (
          <EmptyState
            compact
            title="Nothing recorded yet"
            description="No spending has been entered for this season. This page will not guess at a number."
          />
        ) : (
          <table className="budget-table">
            <thead>
              <tr>
                <th>Where it came from</th>
                <th className="num">Entries</th>
                <th className="num">Spent</th>
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
            <Button variant="primary" type="submit" disabled={busy}>
              Record fee
            </Button>
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
          <p className="app-muted">
            Owners and admins already have access. Use this to give a mentor who is neither one
            budget access without making them an admin. Nobody can grant it to themselves.
          </p>
          {payload.implicitHolders.length > 0 ? (
            <p className="app-muted">
              Already have it by role:{" "}
              {payload.implicitHolders
                .map((person) => `${person.name || person.email} (${person.role})`)
                .join(", ")}
              .
            </p>
          ) : null}
          {payload.grants.length === 0 ? (
            <p className="app-muted">No extra budget access has been granted.</p>
          ) : (
            <ul className="budget-grant-list">
              {payload.grants.map((grant) => (
                <li key={grant.userId}>
                  <span>
                    <strong>{grant.name || grant.email}</strong>{" "}
                    <span className="app-muted">
                      granted {new Date(grant.grantedAt).toLocaleDateString()}
                      {grant.grantedByName ? ` by ${grant.grantedByName}` : ""}
                    </span>
                  </span>
                  <Button variant="ghost" type="button" disabled={busy} onClick={() => { void act( { action: "revoke-budget-access", userId: grant.userId }, `Budget access removed from ${grant.name || grant.email}.`, ); }}>
                    Remove access
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {payload.candidates.length > 0 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!grantUserId) return;
                const person = payload.candidates.find((c) => c.userId === grantUserId);
                void act(
                  { action: "grant-budget-access", userId: grantUserId },
                  `Budget access granted to ${person?.name || person?.email || "that member"}.`,
                ).then((ok) => {
                  if (ok) setGrantUserId("");
                });
              }}
            >
              <label className="budget-field">
                <span>Give budget access to</span>
                <select value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)}>
                  <option value="">Choose a team member…</option>
                  {payload.candidates.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name || person.email} ({person.role})
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="primary" type="submit" disabled={busy || !grantUserId}>
                Grant budget access
              </Button>
            </form>
          ) : null}
        </Panel>
      ) : null}

      {error ? <p className="budget-error">{error}</p> : null}
      {notice ? <p className="budget-notice">{notice}</p> : null}
    </main>
  );
}
