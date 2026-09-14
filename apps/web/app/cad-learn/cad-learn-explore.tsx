"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { ExploreDocument, ExploreProgressView } from "../../lib/cad-learn/explore-progress";

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

export function ExploreOnshapeBoard({ orgId }: { orgId?: string | null }) {
  const [view, setView] = useState<ExploreProgressView | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
      const response = await fetch(`/api/cad-learn/explore${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        setView({
          status: "setup",
          message: "Choose your team to see documents from the connected Onshape account.",
        });
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      if (!isExploreView(data)) {
        setView({
          status: "error",
          message: "Could not load Explore Onshape. Try again when you have a connection.",
        });
        return;
      }
      setView(data);
    } catch {
      setView({
        status: "error",
        message: "Could not load Explore Onshape. Try again when you have a connection.",
      });
    } finally {
      setReady(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const documents: ExploreDocument[] = view?.status === "ready" ? view.documents : [];

  return (
    <section className="cl-explore" id="explore" aria-labelledby="cl-explore-title">
      <header>
        <h2 id="cl-explore-title">Explore Onshape</h2>
        <p>
          Documents on the Onshape account connected to this team — names and last-edited times only.
          Feature counts stay blank unless Onshape sent them.
        </p>
      </header>
      {!ready ? <p className="cl-muted">Loading documents from Onshape…</p> : null}
      {ready && view?.status === "setup" ? (
        <div className="cl-explore-empty">
          <p>{view.message}</p>
          <Button as="a" variant="primary" href={withOrgHref("/cad/setup", orgId)}>
            Connect Onshape
          </Button>
        </div>
      ) : null}
      {ready && view?.status === "error" ? (
        <div className="cl-explore-empty">
          <p>{view.message}</p>
          <Button variant="primary" type="button" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}
      {ready && view?.status === "ready" && documents.length === 0 ? (
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
