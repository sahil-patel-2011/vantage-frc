"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { partsRelayCategoryLabel, partsRelayConditionLabel, deriveLoanStatus } from "../../lib/parts-relay";
import {
  PARTS_RELAY_CATEGORIES,
  PARTS_RELAY_CONDITIONS,
  PARTS_RELAY_LOAN_DIRECTIONS,
  type PartsRelayView,
} from "../../lib/parts-relay/compute-parts-relay";
import type {
  PartsRelayCategory,
  PartsRelayCondition,
  PartsRelayListingType,
  PartsRelayLoan,
  PartsRelayLoanDirection,
} from "../../lib/parts-relay/types";

type LiveView = Extract<PartsRelayView, { status: "live" }>;

function statusTone(status: string): string {
  if (status === "open" || status === "active") return "setup";
  if (status === "fulfilled" || status === "returned") return "good";
  if (status === "overdue" || status === "lost") return "demo";
  return "setup";
}

export default function PartsRelayClient() {
  const [view, setView] = useState<PartsRelayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setErrorStatus(null);
    setLoadError("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/parts-relay${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PartsRelayView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/parts-relay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as PartsRelayView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Parts Relay"}
          </>
        }
        title="Parts Relay"
        description="Post what your team needs or can lend at an event, then track the hand-off — who has it, when it's due back, and whether it came home."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: loadError,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadError || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <ListingForm busy={busy} mutate={mutate} />
          <Listings view={view} busy={busy} mutate={mutate} />
          <LoanForm busy={busy} mutate={mutate} />
          <Loans view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Open needs", value: String(summary.openNeeds) },
    { label: "Open offers", value: String(summary.openOffers) },
    { label: "Active loans", value: String(summary.activeLoans) },
    { label: "Overdue", value: String(summary.overdueLoans) },
    {
      label: "On-time returns",
      value: summary.onTimeReturnRate == null ? "—" : `${Math.round(summary.onTimeReturnRate * 100)}%`,
    },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ListingForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      listingType: "need" as PartsRelayListingType,
      partName: "",
      category: "other" as PartsRelayCategory,
      quantity: "1",
      condition: "any" as PartsRelayCondition,
      eventKey: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.partName.trim()) return;
        mutate({
          action: "create-listing",
          listingType: form.listingType,
          partName: form.partName,
          category: form.category,
          quantity: Number(form.quantity) || 1,
          condition: form.condition,
          eventKey: form.eventKey || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Post a need or offer</h2>
      <FormGrid min={160}>
        <FormRow label="Type">
          <select value={form.listingType} onChange={set("listingType")}>
            <option value="need">Need</option>
            <option value="offer">Offer</option>
          </select>
        </FormRow>
        <FormRow label="Part">
          <input value={form.partName} onChange={set("partName")} placeholder="775pro motor" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {PARTS_RELAY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {partsRelayCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Condition">
          <select value={form.condition} onChange={set("condition")}>
            {PARTS_RELAY_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {partsRelayConditionLabel(condition)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={1} value={form.quantity} onChange={set("quantity")} />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.partName.trim()}>
          Post listing
        </button>
      </div>
    </Panel>
  );
}

function Listings({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.listings.length === 0) {
    return (
      <EmptyState
        badge="No listings yet"
        badgeTone="setup"
        title="Post your first need or offer"
        description="Other teams at your event can only match a listing that exists."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Listings</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.listings.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${statusTone(item.status)}`}>{item.status}</span>{" "}
              <strong>
                {item.listingType === "need" ? "Need" : "Offer"}: {item.partName}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {partsRelayCategoryLabel(item.category)} · {partsRelayConditionLabel(item.condition)} · qty {item.quantity}
                {item.eventKey ? ` · ${item.eventKey}` : ""}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.status === "open" ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "update-listing-status", listingId: item.id, status: "fulfilled" })}
                >
                  Mark fulfilled
                </button>
              ) : null}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete listing "${item.partName}"?`)) {
                    mutate({ action: "delete-listing", listingId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LoanForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      direction: "lending" as PartsRelayLoanDirection,
      counterpartyTeam: "",
      partName: "",
      quantity: "1",
      eventKey: "",
      loanedOn: new Date().toISOString().slice(0, 10),
      dueBackOn: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.counterpartyTeam.trim() || !form.partName.trim() || !form.loanedOn) return;
        mutate({
          action: "log-loan",
          direction: form.direction,
          counterpartyTeam: form.counterpartyTeam,
          partName: form.partName,
          quantity: Number(form.quantity) || 1,
          eventKey: form.eventKey || undefined,
          loanedOn: form.loanedOn,
          dueBackOn: form.dueBackOn || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a hand-off</h2>
      <FormGrid min={160}>
        <FormRow label="Direction">
          <select value={form.direction} onChange={set("direction")}>
            {PARTS_RELAY_LOAN_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {direction === "lending" ? "We're lending" : "We're borrowing"}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Other team">
          <input value={form.counterpartyTeam} onChange={set("counterpartyTeam")} placeholder="1114" required />
        </FormRow>
        <FormRow label="Part">
          <input value={form.partName} onChange={set("partName")} placeholder="Spare wheels" required />
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={1} value={form.quantity} onChange={set("quantity")} />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
        <FormRow label="Loaned on">
          <input type="date" value={form.loanedOn} onChange={set("loanedOn")} required />
        </FormRow>
        <FormRow label="Due back (optional)">
          <input type="date" value={form.dueBackOn} onChange={set("dueBackOn")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.counterpartyTeam.trim() || !form.partName.trim() || !form.loanedOn}
        >
          Log hand-off
        </button>
      </div>
    </Panel>
  );
}

function Loans({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.loans.length === 0) {
    return (
      <EmptyState
        badge="No hand-offs yet"
        badgeTone="setup"
        title="Log a loan once you match with another team"
        description="Track what's lent out and what's borrowed so nothing goes home in the wrong pit."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Hand-offs</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.loans.map((item: PartsRelayLoan) => {
          const effectiveStatus = deriveLoanStatus(item);
          return (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${statusTone(effectiveStatus)}`}>{effectiveStatus}</span>{" "}
                <strong>
                  {item.direction === "lending" ? "Lent to" : "Borrowed from"} {item.counterpartyTeam}: {item.partName}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  qty {item.quantity} · loaned {item.loanedOn}
                  {item.dueBackOn ? ` · due ${item.dueBackOn}` : ""}
                  {item.returnedOn ? ` · returned ${item.returnedOn}` : ""}
                  {item.eventKey ? ` · ${item.eventKey}` : ""}
                </small>
                {item.notes ? <small className="app-muted">{item.notes}</small> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {item.status === "active" || effectiveStatus === "overdue" ? (
                  <>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => mutate({ action: "mark-loan-returned", loanId: item.id })}
                    >
                      Mark returned
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => mutate({ action: "mark-loan-lost", loanId: item.id })}
                    >
                      Mark lost
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete this hand-off record with ${item.counterpartyTeam}?`)) {
                      mutate({ action: "delete-loan", loanId: item.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
