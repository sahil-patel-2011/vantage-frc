"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, TextBlockSkeleton } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { ExploreDocument, ExploreProgressView } from "../../lib/cad-learn/explore-progress";

/** What the board can show: the API's own states, plus "signed out" and "not on this team". */
type ExploreState = ExploreProgressView | { status: "signin" } | { status: "team" };

function isExploreView(value: unknown): value is ExploreProgressView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "ready" || status === "setup" || status === "error";
}

function formatEdited(iso: string | null): string {
  if (!iso) return "Last edited time not on the document";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Last edited time not on the document";
  return `Last edited ${date.toLocaleString()}`;
}

const LOAD_FAILED = "Could not load your Onshape documents. Check your connection and try again.";

/**
 * Documents on the connected Onshape account. `pending` while the page is still
 * working out which team this is: the board shows placeholder rows and waits,
 * rather than asking Onshape twice (once without the team, once with it).
 */
export function ExploreOnshapeBoard({ orgId, pending = false }: { orgId?: string | null; pending?: boolean }) {
  const [view, setView] = useState<ExploreState | null>(null);

  const load = useCallback(async () => {
    try {
      const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const response = await fetch(`/api/cad-learn/explore${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (response.status === 401) {
        setView({ status: "signin" });
        return;
      }
      if (response.status === 403) {
        setView({ status: "team" });
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      setView(isExploreView(data) ? data : { status: "error", message: LOAD_FAILED });
    } catch {
      setView({ status: "error", message: LOAD_FAILED });
    }
  }, [orgId]);

  useEffect(() => {
    if (pending) return;
    void load();
  }, [load, pending]);

  const documents: ExploreDocument[] = view?.status === "ready" ? view.documents : [];

  return (
    <section className="cl-explore" id="explore" aria-labelledby="cl-explore-title" aria-busy={!view}>
      <header>
        <h2 id="cl-explore-title">Explore Onshape</h2>
        <p>
          Documents on the Onshape account connected to this team — names and last-edited times only.
          Feature counts stay blank unless Onshape sent them.
        </p>
      </header>
      {!view ? <TextBlockSkeleton lines={3} /> : null}
      {view?.status === "signin" ? (
        <div className="cl-explore-empty">
          <p>Sign in to see the documents on your Onshape account.</p>
          <Button as="a" variant="secondary" href="/signin?next=%2Fcad-learn">
            Sign in
          </Button>
        </div>
      ) : null}
      {view?.status === "team" ? (
        <div className="cl-explore-empty">
          <p>You are not on this team, so its Onshape account is not shown.</p>
          <Button as="a" variant="secondary" href="/workspace">
            Choose your team
          </Button>
        </div>
      ) : null}
      {view?.status === "setup" ? (
        <div className="cl-explore-empty">
          <p>{view.message}</p>
          <Button as="a" variant="secondary" href={withOrgHref("/cad/setup", orgId)}>
            Connect Onshape
          </Button>
        </div>
      ) : null}
      {view?.status === "error" ? (
        <div className="cl-explore-empty" role="alert">
          <p>{view.message}</p>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setView(null);
              void load();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {view?.status === "ready" && documents.length === 0 ? (
        <p className="cl-muted">No documents in this Onshape account yet. Build the first lesson part, then refresh.</p>
      ) : null}
      {documents.length > 0 ? (
        <ul className="cl-explore-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a href={doc.href} target="_blank" rel="noreferrer noopener">
                {doc.name}
              </a>
              <span>{formatEdited(doc.modifiedAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
