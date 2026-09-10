"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { adminRelatedLinks } from "../../../lib/admin";
import {
  BILLING_DISPLAY_STATUSES,
  type BillingDisplayStatus,
  type OrgPlanLedgerRow,
  type StripeWiringSnapshot,
} from "../../../lib/admin-org-plans";
import "../admin-flow.css";

type PlanOption = { code: string; name: string };

function money(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

function shortId(value: string | null): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
}

export default function AdminPlansClient() {
  const [rows, setRows] = useState<OrgPlanLedgerRow[]>([]);
  const [planOptions, setPlanOptions] = useState<PlanOption[]>([]);
  const [wiring, setWiring] = useState<StripeWiringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | BillingDisplayStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/plans");
      const data = (await response.json()) as {
        organizations?: OrgPlanLedgerRow[];
        planOptions?: PlanOption[];
        stripeWiring?: StripeWiringSnapshot;
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load org plans.");
        setRows([]);
        return;
      }
      setMessage("");
      setRows(data.organizations ?? []);
      setPlanOptions(data.planOptions ?? []);
      setWiring(data.stripeWiring ?? null);
    } catch {
      setMessage("Network error loading org plans.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (planFilter !== "all" && row.planCode !== planFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      return true;
    });
  }, [rows, planFilter, statusFilter]);

  const summary = useMemo(() => {
    const byStatus = Object.fromEntries(BILLING_DISPLAY_STATUSES.map((s) => [s, 0])) as Record<
      BillingDisplayStatus,
      number
    >;
    for (const row of rows) byStatus[row.status] += 1;
    return { total: rows.length, ...byStatus };
  }, [rows]);

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Plans"
        title="Org plans"
        description="Which teams are on which plan — entitlement status, included API allowance, and Stripe IDs when present. Live ledger only."
      >
        <nav className="settings-inline-links admin-related" aria-label="Platform shortcuts">
          {adminRelatedLinks({
            active: "plans",
            include: ["teams", "support", "releases", "waitlist"],
          }).map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href="/admin/commercial">Commercial</a>
        </nav>
      </PageHeader>

      <div className="cards">
        <article className="card">
          <span>Organizations</span>
          <strong>{loading ? "…" : summary.total}</strong>
        </article>
        <article className="card">
          <span>Active / trial</span>
          <strong>{loading ? "…" : summary.active + summary.trial}</strong>
        </article>
        <article className="card">
          <span>Past due</span>
          <strong>{loading ? "…" : summary.past_due}</strong>
        </article>
      </div>

      {wiring && wiring.blockers.length > 0 ? (
        <Panel className="admin-plans-wiring">
          <span className="eyebrow">Stripe wiring</span>
          <p>
            Checkout and subscription sync are coded, but not fully wired in this environment. The table still
            reads entitlements and any Stripe IDs already stored.
          </p>
          <ul>
            {wiring.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <form
        className="admin-plans-filters"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          Plan
          <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">All plans</option>
            <option value="free">Free</option>
            {planOptions
              .filter((plan) => plan.code !== "free")
              .map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | BillingDisplayStatus)}
          >
            <option value="all">All statuses</option>
            {BILLING_DISPLAY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </form>

      {message ? <p className="admin-plans-message">{message}</p> : null}

      <Panel>
        <span className="eyebrow">Ledger</span>
        {loading ? (
          <p className="admin-empty">Loading plans…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No matching organizations"
            description="Try clearing the plan or status filter, or provision a team from Admin → Teams."
          />
        ) : (
          <div className="admin-plans-table-wrap">
            <table className="admin-plans-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Included API $</th>
                  <th>Members</th>
                  <th>Stripe customer</th>
                  <th>Stripe sub</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        #{row.teamNumber} {row.name}
                      </strong>
                      <small>{row.slug}</small>
                    </td>
                    <td>
                      <strong>{row.planName}</strong>
                      <small>{row.planCode}</small>
                    </td>
                    <td>
                      <span className={`admin-plans-status admin-plans-status-${row.status}`}>{row.status}</span>
                    </td>
                    <td>{money(row.includedAllowanceUsd)}</td>
                    <td>{row.memberCount}</td>
                    <td title={row.stripeCustomerId ?? undefined}>
                      <code>{shortId(row.stripeCustomerId)}</code>
                    </td>
                    <td title={row.stripeSubscriptionId ?? undefined}>
                      <code>{shortId(row.stripeSubscriptionId)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
