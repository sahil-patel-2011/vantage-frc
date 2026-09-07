"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { knowledgeHitHref } from "../../lib/knowledge/helpers";
import { MAX_BODY, MAX_TITLE } from "../../lib/knowledge/types";
import {
  CAPTURE_SOURCE_HREF,
  captureSourceLabel,
  type CaptureCandidate,
  type CaptureDraftRecord,
} from "../../lib/knowledge-capture/types";
import type { CaptureView } from "../../lib/knowledge-capture/compute-capture";
import "./knowledge-drafts.css";

type LiveView = Extract<CaptureView, { status: "live" }>;

export default function KnowledgeDraftsClient() {
  const [view, setView] = useState<CaptureView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : "";
    void fetch(`/api/knowledge-drafts${query}`)
      .then(async (response) => {
        const data = (await response.json()) as CaptureView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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
    async (payload: Record<string, unknown>, successNote?: string) => {
      if (!orgId || busy) return false;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/knowledge-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as CaptureView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return false;
        }
        setView(data);
        if (successNote) setNotice(successNote);
        return true;
      } catch {
        setError("Network error — please try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const failure = fetchFailed
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
            <a href={orgId ? `/team?tab=knowledge&orgId=${encodeURIComponent(orgId)}` : "/team?tab=knowledge"}>
              Playbook
            </a>
            {" / Knowledge drafts"}
          </>
        }
        title="Knowledge drafts"
        description="Finished work proposes a Playbook page. You approve it, or it never exists."
      />

      {notice ? (
        <p className="telemetry-status" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
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
        <ReviewQueue view={view} busy={busy} mutate={mutate} />
      )}
    </main>
  );
}

type Mutate = (payload: Record<string, unknown>, successNote?: string) => Promise<boolean>;

function ReviewQueue({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const openDrafts = useMemo(() => view.drafts.filter((row) => row.status === "draft"), [view.drafts]);
  const reviewed = useMemo(() => view.drafts.filter((row) => row.status !== "draft"), [view.drafts]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="kd-note">
        <strong>Nothing here publishes on its own.</strong> A draft becomes a Playbook page only
        when you press Approve. Every line in a proposal is text someone already recorded on the
        source record — blanks are left out rather than filled in.
      </p>

      <Panel>
        <div className="kd-counts">
          <div className="kd-count">
            <strong>{view.counts.candidates}</strong>
            <span className="app-muted">Ready to draft</span>
          </div>
          <div className="kd-count">
            <strong>{view.counts.openDrafts}</strong>
            <span className="app-muted">Waiting for review</span>
          </div>
          <div className="kd-count">
            <strong>{view.counts.approved}</strong>
            <span className="app-muted">Approved pages</span>
          </div>
          <div className="kd-count">
            <strong>{view.counts.dismissed}</strong>
            <span className="app-muted">Dismissed</span>
          </div>
        </div>
      </Panel>

      <CandidateSection view={view} busy={busy} mutate={mutate} />

      {openDrafts.length > 0 ? (
        <section className="app-card soft-panel" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Review queue</h2>
          <ul className="kd-list">
            {openDrafts.map((draft) => (
              <li key={draft.id}>
                <DraftCard draft={draft} busy={busy} mutate={mutate} orgId={view.orgId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reviewed.length > 0 ? (
        <section className="app-card soft-panel" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Already reviewed</h2>
          <ul className="kd-list">
            {reviewed.map((draft) => (
              <li key={draft.id}>
                <ReviewedRow draft={draft} orgId={view.orgId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CandidateSection({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const { candidates } = view;

  if (candidates.length === 0) {
    if (view.drafts.length > 0) return null;
    return (
      <EmptyState
        badge="Not enough recorded yet"
        badgeTone="setup"
        title="No finished work has enough written down to draft from"
        description="Drafts come from accepted decisions, closed-out safety incidents, and resolved pit repairs that recorded some prose. A record with only a title has nothing to say, so nothing is invented for it."
      >
        <a className="app-button" href="/decisions">
          Open the decision log
        </a>
      </EmptyState>
    );
  }

  return (
    <section className="app-card soft-panel" style={{ display: "grid", gap: 12 }}>
      <div className="kd-card-head">
        <div>
          <h2 style={{ margin: 0 }}>Finished work with no draft yet</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            {candidates.length} record{candidates.length === 1 ? "" : "s"} could propose a page.
          </p>
        </div>
        <button
          type="button"
          className="app-button"
          style={{ minHeight: 44 }}
          disabled={busy}
          onClick={() => {
            void mutate(
              { action: "generate" },
              "Drafts written. Nothing was published — review each one below.",
            );
          }}
        >
          {busy ? "Drafting…" : `Draft ${candidates.length} page${candidates.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <ul className="kd-list">
        {candidates.slice(0, 12).map((candidate) => (
          <li key={`${candidate.sourceKind}:${candidate.sourceId}`}>
            <CandidateRow candidate={candidate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CandidateRow({ candidate }: { candidate: CaptureCandidate }) {
  return (
    <div className="kd-card">
      <div className="kd-card-head">
        <h3>{candidate.proposedTitle}</h3>
        <span className="kd-kind">{captureSourceLabel(candidate.sourceKind)}</span>
      </div>
      <dl className="kd-evidence">
        {candidate.evidence.slice(0, 2).map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.text.length > 260 ? `${row.text.slice(0, 260)}…` : row.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DraftCard({
  draft,
  busy,
  mutate,
  orgId,
}: {
  draft: CaptureDraftRecord;
  busy: boolean;
  mutate: Mutate;
  orgId: string;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "dismiss">("view");
  const [title, setTitle] = useState(draft.proposedTitle);
  const [body, setBody] = useState(draft.proposedBody);
  const [reason, setReason] = useState("");

  const sourceHref = `${CAPTURE_SOURCE_HREF[draft.sourceKind]}?orgId=${encodeURIComponent(orgId)}`;

  return (
    <div className="kd-card">
      <div className="kd-card-head">
        <h3>{draft.proposedTitle}</h3>
        <span className="kd-kind">{captureSourceLabel(draft.sourceKind)}</span>
      </div>

      <div className="kd-split">
        <div className="kd-pane">
          <h4>What the record says</h4>
          {draft.sourceTitle ? (
            <p className="app-muted" style={{ margin: "0 0 8px" }}>
              {draft.sourceTitle}
            </p>
          ) : null}
          {draft.evidence.length > 0 ? (
            <dl className="kd-evidence">
              {draft.evidence.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="app-muted" style={{ margin: 0 }}>
              The source record was edited or removed since this draft was written. Read it before
              approving.
            </p>
          )}
          <p style={{ margin: "10px 0 0" }}>
            <a href={sourceHref}>Open the source record</a>
          </p>
        </div>

        <div className="kd-pane">
          <h4>Proposed Playbook page</h4>
          {mode === "edit" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <label className="kd-field">
                <span>Title</span>
                <input
                  type="text"
                  value={title}
                  maxLength={MAX_TITLE}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="kd-field">
                <span>Body (markdown)</span>
                <textarea
                  value={body}
                  maxLength={MAX_BODY}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <>
              <p className="kd-slug">/{draft.proposedSlug}</p>
              <pre className="kd-body">{draft.proposedBody}</pre>
            </>
          )}
        </div>
      </div>

      {mode === "dismiss" ? (
        <label className="kd-field">
          <span>Why is this not worth keeping?</span>
          <input
            type="text"
            value={reason}
            maxLength={500}
            placeholder="e.g. duplicates the swerve handoff page"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      ) : null}

      <div className="kd-actions">
        {mode === "edit" ? (
          <>
            <button
              type="button"
              className="app-button"
              disabled={busy || !title.trim()}
              onClick={() => {
                void mutate(
                  { action: "edit-draft", draftId: draft.id, title: title.trim(), body },
                  "Draft saved. It is still a draft until you approve it.",
                ).then((ok) => {
                  if (ok) setMode("view");
                });
              }}
            >
              Save draft
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => {
                setTitle(draft.proposedTitle);
                setBody(draft.proposedBody);
                setMode("view");
              }}
            >
              Cancel
            </button>
          </>
        ) : mode === "dismiss" ? (
          <>
            <button
              type="button"
              className="app-button"
              disabled={busy || !reason.trim()}
              onClick={() => {
                void mutate(
                  { action: "dismiss", draftId: draft.id, reason: reason.trim() },
                  "Dismissed. No page was created.",
                );
              }}
            >
              Confirm dismiss
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {/* Exactly one primary action on the card: publishing is the decision. */}
            <button
              type="button"
              className="app-button"
              disabled={busy}
              onClick={() => {
                void mutate(
                  { action: "approve", draftId: draft.id },
                  "Approved — the page is now in the Playbook.",
                );
              }}
            >
              Approve as a page
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => setMode("dismiss")}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewedRow({ draft, orgId }: { draft: CaptureDraftRecord; orgId: string }) {
  return (
    <div className="kd-card">
      <div className="kd-card-head">
        <h3>{draft.proposedTitle}</h3>
        <span className="kd-kind">
          {draft.status === "approved" ? "Approved" : "Dismissed"} ·{" "}
          {captureSourceLabel(draft.sourceKind)}
        </span>
      </div>
      {draft.status === "approved" && draft.knowledgePageId ? (
        <p style={{ margin: 0 }}>
          <a href={knowledgeHitHref("wiki", draft.knowledgePageId, orgId, draft.proposedSlug)}>
            Open the Playbook page
          </a>
        </p>
      ) : null}
      {draft.status === "dismissed" && draft.dismissedReason ? (
        <p className="app-muted" style={{ margin: 0 }}>
          Dismissed: {draft.dismissedReason}
        </p>
      ) : null}
    </div>
  );
}
