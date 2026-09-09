"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel, type BadgeTone } from "../../components/ui";
import {
  describeApprovalImpact,
  type PartRequest,
  type PartRequestsView,
} from "../../lib/part-requests/compute-part-requests";

const money = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" });

function statusTone(status: PartRequest["status"]): BadgeTone {
  if (status === "rejected") return "danger";
  if (status === "pending") return "info";
  if (status === "approved" || status === "ordered" || status === "received") return "good";
  return "neutral";
}

function RequestCard({
  request,
  children,
}: {
  request: PartRequest;
  children?: React.ReactNode;
}) {
  return (
    <li className="pr-item">
      <div className="pr-item-head">
        <div>
          <h3>{request.title}</h3>
          <p className="app-muted">
            {request.quantity} x {money(request.unitCostUsd)} ={" "}
            <strong>{money(request.totalCostUsd)}</strong>
            {request.vendor && request.vendor !== "unspecified" ? ` · ${request.vendor}` : ""}
            {request.neededBy ? ` · needed by ${request.neededBy}` : ""}
          </p>
        </div>
        <Badge tone={statusTone(request.status)}>{request.statusLabel}</Badge>
      </div>
      {request.justification ? <p className="pr-body">{request.justification}</p> : null}
      {request.requestedByName && !request.mine ? (
        <p className="app-muted">Asked by {request.requestedByName}</p>
      ) : null}
      {request.reviewNotes ? (
        <p className="pr-review">
          {request.reviewedByName ? `${request.reviewedByName}: ` : ""}
          {request.reviewNotes}
        </p>
      ) : null}
      {request.itemUrl ? (
        <p>
          <a href={request.itemUrl} target="_blank" rel="noreferrer noopener">
            Vendor link
          </a>
        </p>
      ) : null}
      {children}
    </li>
  );
}

export default function PartRequestsClient() {
  const [view, setView] = useState<PartRequestsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [justification, setJustification] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [estimate, setEstimate] = useState("");
  const [vendor, setVendor] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [neededBy, setNeededBy] = useState("");

  // "Request this" from the parts catalog lands here with the item filled in.
  // Read once on mount; nothing is submitted until the person presses the button.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("title");
    const v = q.get("vendor");
    const u = q.get("itemUrl");
    if (t) setTitle(t.slice(0, 200));
    if (v) setVendor(v.slice(0, 120));
    if (u && /^https:\/\//.test(u)) setItemUrl(u.slice(0, 500));
  }, []);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const [decide, setDecide] = useState<{ id: string; kind: "approve" | "reject" } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/part-requests");
      const data = (await response.json()) as PartRequestsView & { error?: string };
      if (!response.ok) {
        setError((data as { error?: string }).error ?? "Could not load part requests.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
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
      const response = await fetch("/api/part-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as PartRequestsView & { error?: string };
      if (!response.ok) {
        setError((data as { error?: string }).error ?? "That did not work.");
        return false;
      }
      setView(data);
      setNotice(success);
      return true;
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <main className="module-page part-requests-page">
        <PageHeader breadcrumbs="Business / Money" title="Part requests" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="Part requests need a team workspace" description={error}>
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page part-requests-page">
        <PageHeader breadcrumbs="Business / Money" title="Part requests" />
        <Panel>
          <p className="app-muted">Loading…</p>
        </Panel>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page part-requests-page">
        <PageHeader breadcrumbs="Business / Money" title="Part requests" />
        <EmptyState soft badge="Setup" badgeTone="setup" title="Not migrated yet" description={view.message} />
      </main>
    );
  }

  const totalPreview = (Number(quantity) || 0) * (Number(estimate) || 0);

  return (
    <main className="module-page part-requests-page">
      <PageHeader
        breadcrumbs="Business / Money"
        title="Part requests"
        description={`Ask for what you need in ${view.orgName}. A mentor decides, and an approved request becomes real spend against the season budget.`}
      />

      <Panel>
        <h2>Ask for a part</h2>
        <p className="app-muted">
          Anyone on the team can ask — you do not need budget access. Your request is your own
          row; nobody else can file one in your name.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim() || !justification.trim()) {
              setError("Say what you need and why before sending the request.");
              return;
            }
            if (!confirmSubmit) {
              setConfirmSubmit(true);
              return;
            }
            void act(
              {
                action: "submit",
                title,
                justification,
                quantity,
                estimateUsd: estimate === "" ? 0 : estimate,
                vendor,
                itemUrl,
                neededBy: neededBy || undefined,
              },
              "Request sent. A mentor will see it in their queue.",
            ).then((ok) => {
              setConfirmSubmit(false);
              if (ok) {
                setTitle("");
                setJustification("");
                setQuantity("1");
                setEstimate("");
                setVendor("");
                setItemUrl("");
                setNeededBy("");
              }
            });
          }}
        >
          <label className="pr-field">
            <span>What do you need?</span>
            <input
              type="text"
              maxLength={200}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setConfirmSubmit(false);
              }}
            />
          </label>
          <label className="pr-field">
            <span>Why do you need it?</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={justification}
              onChange={(event) => {
                setJustification(event.target.value);
                setConfirmSubmit(false);
              }}
            />
          </label>
          <div className="pr-row">
            <label className="pr-field">
              <span>Quantity</span>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setConfirmSubmit(false);
                }}
              />
            </label>
            <label className="pr-field">
              <span>Estimated cost each (USD)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={estimate}
                onChange={(event) => {
                  setEstimate(event.target.value);
                  setConfirmSubmit(false);
                }}
              />
            </label>
          </div>
          <div className="pr-row">
            <label className="pr-field">
              <span>Vendor (optional)</span>
              <input
                type="text"
                maxLength={120}
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
              />
            </label>
            <label className="pr-field">
              <span>Needed by (optional)</span>
              <input
                type="date"
                value={neededBy}
                onChange={(event) => setNeededBy(event.target.value)}
              />
            </label>
          </div>
          <label className="pr-field">
            <span>Link to the item (optional)</span>
            <input
              type="url"
              value={itemUrl}
              placeholder="https://"
              onChange={(event) => setItemUrl(event.target.value)}
            />
          </label>
          {confirmSubmit ? (
            <p className="pr-confirm">
              Send this request for about {money(totalPreview)}?{" "}
              <button className="app-button" type="submit" disabled={busy}>
                Yes, send it
              </button>{" "}
              <button className="app-button ghost" type="button" onClick={() => setConfirmSubmit(false)}>
                Cancel
              </button>
            </p>
          ) : (
            <button className="app-button" type="submit" disabled={busy}>
              Send request
            </button>
          )}
        </form>
      </Panel>

      {view.canDecide ? (
        <Panel>
          <h2>Waiting for a decision</h2>
          {view.budget ? (
            <p className="pr-budget">
              {view.budget.state === "budget_no_spend"
                ? `${money(view.budget.totalBudgetUsd ?? 0)} budgeted, nothing recorded against it yet.`
                : view.budget.remainingUsd == null
                  ? `${money(view.budget.recordedSpendUsd)} of spending recorded, with no season budget set.`
                  : `${money(view.budget.remainingUsd)} left of ${money(view.budget.totalBudgetUsd ?? 0)}.`}
            </p>
          ) : null}
          {view.queue.length === 0 ? (
            <EmptyState compact title="Nothing waiting" description="No part requests need a decision right now." />
          ) : (
            <ul className="pr-list">
              {view.queue.map((request) => {
                const impact = describeApprovalImpact(view.budget, request.totalCostUsd);
                const deciding = decide?.id === request.id;
                return (
                  <RequestCard key={request.id} request={request}>
                    {impact ? <p className="pr-impact">{impact}</p> : null}
                    {deciding ? (
                      <div className="pr-decide">
                        <label className="pr-field">
                          <span>Note back to {request.requestedByName ?? "the requester"} (optional)</span>
                          <input
                            type="text"
                            maxLength={1000}
                            value={reviewNotes}
                            onChange={(event) => setReviewNotes(event.target.value)}
                          />
                        </label>
                        <p className="pr-confirm">
                          {decide?.kind === "approve"
                            ? `Approve ${money(request.totalCostUsd)}? This records the money as spent against the season budget straight away.`
                            : "Reject this request? Nothing is charged."}{" "}
                          <button
                            className="app-button"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void act(
                                {
                                  action: decide?.kind === "approve" ? "approve" : "reject",
                                  requestId: request.id,
                                  reviewNotes,
                                },
                                decide?.kind === "approve"
                                  ? "Approved. The cost now counts against the budget."
                                  : "Rejected. Nothing was charged.",
                              ).then(() => {
                                setDecide(null);
                                setReviewNotes("");
                              });
                            }}
                          >
                            Yes, {decide?.kind === "approve" ? "approve" : "reject"}
                          </button>{" "}
                          <button
                            className="app-button ghost"
                            type="button"
                            onClick={() => {
                              setDecide(null);
                              setReviewNotes("");
                            }}
                          >
                            Cancel
                          </button>
                        </p>
                      </div>
                    ) : (
                      <div className="pr-actions">
                        <button
                          className="app-button"
                          type="button"
                          disabled={busy}
                          onClick={() => setDecide({ id: request.id, kind: "approve" })}
                        >
                          Approve
                        </button>
                        <button
                          className="app-button ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => setDecide({ id: request.id, kind: "reject" })}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </RequestCard>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      <Panel>
        <h2>Your requests</h2>
        {view.mine.length === 0 ? (
          <EmptyState compact title="You have not asked for anything yet" description="Requests you send appear here with their decision." />
        ) : (
          <ul className="pr-list">
            {view.mine.map((request) => (
              <RequestCard key={request.id} request={request}>
                {request.status === "approved" ? (
                  <div className="pr-actions">
                    <button
                      className="app-button ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void act(
                          { action: "mark-ordered", requestId: request.id },
                          "Marked as ordered.",
                        );
                      }}
                    >
                      Mark as ordered
                    </button>
                  </div>
                ) : null}
              </RequestCard>
            ))}
          </ul>
        )}
      </Panel>

      {error ? <p className="pr-error">{error}</p> : null}
      {notice ? <p className="pr-notice">{notice}</p> : null}
    </main>
  );
}
