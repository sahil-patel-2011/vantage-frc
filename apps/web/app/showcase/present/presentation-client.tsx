"use client";

import "../../product-styles";
import { useEffect, useState } from "react";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type View = {
  deck: { title: string; subtitle: string | null; isDemo: boolean };
  sections: Array<{
    id: string;
    kind: string;
    title: string;
    content: string;
    studentContent?: string;
    approvedContent?: string;
    aiAssisted: boolean;
    evidenceRefs: Array<{ type: string; id: string; label: string }>;
  }>;
};

function presentFailure(message: string) {
  const kind = classifyLoadFailure({ message });
  return loadFailureCopy(kind, {
    nextPath: "/showcase/present",
    message: kind === "unknown" ? null : message,
  });
}

export default function ShowcasePresentation({
  params,
}: {
  params: { token?: string; orgId?: string; deckId?: string };
}) {
  const token = params.token?.trim() ?? "";
  const orgId = params.orgId?.trim() ?? "";
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token && !orgId) return;
    void (async () => {
      const response = token
        ? await fetch(`/api/showcase/public?token=${encodeURIComponent(token)}`)
        : await fetch(`/api/showcase?orgId=${encodeURIComponent(orgId)}&deckId=${params.deckId ?? ""}`);
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Showcase request failed");
        return;
      }
      if (token) {
        setView(data);
        return;
      }
      setView({
        deck: { title: "Season Impact", subtitle: "Approved student evidence", isDemo: false },
        sections: (data.sections ?? [])
          .filter((section: { approvedAt: string | null }) => section.approvedAt)
          .map(
            (section: {
              id: string;
              kind: string;
              title: string;
              approvedContent: string;
              evidenceRefs: View["sections"][number]["evidenceRefs"];
              aiAssistedDraft: string | null;
            }) => ({
              ...section,
              content: section.approvedContent,
              aiAssisted: Boolean(section.aiAssistedDraft),
            }),
          ),
      });
    })();
  }, [token, orgId, params.deckId]);

  if (!token && !orgId) {
    return (
      <main className="showcase-present">
        <PageHeader
          breadcrumbs="Media / Showcase"
          title="Season Impact"
          description="Present one team's approved season story. Choose your team or open a share link."
        />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="A Season Impact deck belongs to one team. Choose your team, or open a share link from a mentor."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          <Button as="a" variant="secondary" href="/showcase">
            Showcase
          </Button>
        </EmptyState>
      </main>
    );
  }

  if (error) {
    const failure = presentFailure(error);
    return (
      <main className="showcase-present">
        <PageHeader breadcrumbs="Media / Showcase" title="Season Impact" />
        <EmptyState
          soft
          badge={
            failure.kind === "auth"
              ? "Signed out"
              : failure.kind === "forbidden"
                ? "No access"
                : "Unavailable"
          }
          badgeTone="setup"
          title={failure.title}
          description={
            failure.kind === "unknown"
              ? "This share link is not available. Ask a mentor for a new link."
              : failure.description
          }
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : (
            <Button as="a" variant="primary" href="/showcase">
              Showcase
            </Button>
          )}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="showcase-present">
        <PageHeader breadcrumbs="Media / Showcase" title="Season Impact" />
        <p className="app-muted">Loading showcase…</p>
      </main>
    );
  }

  return (
    <main className="showcase-present">
      <header>
        <div>
          <span>Showcase</span>
          <h1>{view.deck.title}</h1>
          <p>{view.deck.subtitle}</p>
        </div>
        {view.deck.isDemo && <strong>Sample deck · not a real season</strong>}
        <Button type="button" variant="secondary" onClick={() => print()}>
          Print evidence packet
        </Button>
      </header>
      {view.sections.map((section, index) => (
        <section key={section.id}>
          <span>
            {String(index + 1).padStart(2, "0")} · {section.kind.toUpperCase()}
          </span>
          <h2>{section.title}</h2>
          <p>{section.content}</p>
          {section.aiAssisted && <em>AI-assisted summary · student approved</em>}
          <footer>
            {section.evidenceRefs.map((ref) => (
              <code key={`${ref.type}:${ref.id}`}>
                {ref.type}: {ref.label ?? ref.id}
              </code>
            ))}
          </footer>
        </section>
      ))}
    </main>
  );
}
