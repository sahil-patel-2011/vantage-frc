"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
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

function isCaptureView(value: unknown): value is CaptureView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function knowledgeDraftsCacheOrg(data: CaptureView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistKnowledgeDraftsSnapshot(orgHint: string, data: CaptureView): Promise<void> {
  const cacheOrg = knowledgeDraftsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("knowledge-drafts", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("knowledge-drafts", "_", data);
  } catch {
    // Live Knowledge drafts already painted; IndexedDB is best-effort.
  }
}

function KnowledgeDraftsRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related playbook tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "knowledge", orgId)}>
        Playbook
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/decisions", orgId)}>
        Decisions
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/getting-started", orgId)}>
        Team setup
      </Button>
    </nav>
  );
}

function KnowledgeDraftsNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "playbook",
      label: "Open Playbook",
      detail: "Approved drafts land as pages the team can actually read.",
      href: hubHref("/team", "knowledge", orgId),
      primary: true,
    },
    {
      id: "decisions",
      label: "Open the decision log",
      detail: "Accepted decisions are the first source this queue drafts from.",
      href: withOrgHref("/decisions", orgId),
    },
    {
      id: "setup",
      label: "Open Team setup",
      detail: "The team setup checklist tracks whether the Playbook has real writing yet.",
      href: withOrgHref("/team/getting-started", orgId),
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function KnowledgeDraftsClient() {
  const [view, setView] = useState<CaptureView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CaptureView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CaptureView>("knowledge-drafts", orgHint || "_");
      if (!viewRef.current && cached?.data && isCaptureView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
      const response = await fetch(`/api/knowledge-drafts${query}`, {
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
        setLoadError(responseError(data));
        return;
      }
      if (!response.ok || !isCaptureView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Knowledge drafts. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistKnowledgeDraftsSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Knowledge drafts. Showing the last copy on this device.");
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isCaptureView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return false;
        }
        setView(data);
        setFromCache(false);
        void persistKnowledgeDraftsSnapshot(orgId, data);
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

  const header = (
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
    >
      <KnowledgeDraftsRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
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
        {header}
        <OfflineBanner feature="Knowledge drafts" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Knowledge drafts"}
          description={failure ? failure.description : "Checking your team."}
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

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Knowledge drafts" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
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
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Knowledge drafts" fromCache={fromCache} cachedAt={cachedAt} />
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
          <ReviewQueue view={view} busy={busy} mutate={mutate} />
          {orgId ? <KnowledgeDraftsNextActions orgId={orgId} /> : null}
        </main>
      );
    default: {
      view satisfies never;
      return null;
    }
  }
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
        <Button as="a" variant="primary" href="/decisions">
          Open the decision log
        </Button>
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
        <Button variant="primary" type="button" style={{ minHeight: 44 }} disabled={busy} onClick={() => { void mutate( { action: "generate" }, "Drafts written. Nothing was published — review each one below.", ); }}>
          {busy ? "Drafting…" : `Draft ${candidates.length} page${candidates.length === 1 ? "" : "s"}`}
        </Button>
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
            <Button variant="primary" type="button" disabled={busy || !title.trim()} onClick={() => { void mutate( { action: "edit-draft", draftId: draft.id, title: title.trim(), body }, "Draft saved. It is still a draft until you approve it.", ).then((ok) => { if (ok) setMode("view"); }); }}>
              Save draft
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => { setTitle(draft.proposedTitle); setBody(draft.proposedBody); setMode("view"); }}>
              Cancel
            </Button>
          </>
        ) : mode === "dismiss" ? (
          <>
            <Button variant="primary" type="button" disabled={busy || !reason.trim()} onClick={() => { void mutate( { action: "dismiss", draftId: draft.id, reason: reason.trim() }, "Dismissed. No page was created.", ); }}>
              Confirm dismiss
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => setMode("view")}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* Exactly one primary action on the card: publishing is the decision. */}
            <Button variant="primary" type="button" disabled={busy} onClick={() => { void mutate( { action: "approve", draftId: draft.id }, "Approved — the page is now in the Playbook.", ); }}>
              Approve as a page
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => setMode("dismiss")}>
              Dismiss
            </Button>
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
