"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

type LiveView = Extract<PartsRelayView, { status: "live" }>;

function isPartsRelayView(value: unknown): value is PartsRelayView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function partsRelayCacheOrg(data: PartsRelayView, orgHint: string): string {
  switch (data.status) {
    case "live":
      return data.orgId.trim() || orgHint;
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistPartsRelaySnapshot(orgHint: string, data: PartsRelayView): Promise<void> {
  const cacheOrg = partsRelayCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("parts-relay", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("parts-relay", "_", data);
  } catch {
    // Live Parts relay already painted; IndexedDB is best-effort.
  }
}

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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PartsRelayView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<PartsRelayView>("parts-relay", orgHint || "_");
      if (!viewRef.current && cached?.data && isPartsRelayView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    setLoadError("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/parts-relay${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isPartsRelayView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Parts relay. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        setFetchFailed(true);
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistPartsRelaySnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Parts relay. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PartsRelayView | { error?: string };
        if (!response.ok || !isPartsRelayView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistPartsRelaySnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
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
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href="/build">Build</a>
              {" / Parts relay"}
            </>
          }
          title="Parts relay"
          description="Post what your team needs or can lend at an event, then track the hand-off — who has it, when it's due back, and whether it came home."
        />
        <OfflineBanner feature="Parts relay" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={copy ? copy.title : "Opening Parts relay"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : copy?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href="/build">Build</a>
                {" / Parts relay"}
              </>
            }
            title="Parts relay"
            description="Post what your team needs or can lend at an event, then track the hand-off — who has it, when it's due back, and whether it came home."
          />
          <OfflineBanner feature="Parts relay" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      const data: never = view;
      return data satisfies never;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Parts relay"}
          </>
        }
        title="Parts relay"
        description="Post what your team needs or can lend at an event, then track the hand-off — who has it, when it's due back, and whether it came home."
      />
      <OfflineBanner feature="Parts relay" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <ListingForm busy={busy} mutate={mutate} />
        <Listings view={view} busy={busy} mutate={mutate} />
        <LoanForm busy={busy} mutate={mutate} />
        <Loans view={view} busy={busy} mutate={mutate} />
      </div>
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
        <Button variant="primary" type="submit" disabled={busy || !form.partName.trim()}>
          Post listing
        </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.counterpartyTeam.trim() || !form.partName.trim() || !form.loanedOn}>
          Log hand-off
        </Button>
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
