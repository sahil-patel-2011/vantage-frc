"use client";

import "../../product-styles";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui";

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

export default function ShowcasePresentation({
  params,
}: {
  params: { token?: string; orgId?: string; deckId?: string };
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const response = params.token
        ? await fetch(`/api/showcase/public?token=${encodeURIComponent(params.token)}`)
        : await fetch(`/api/showcase?orgId=${params.orgId}&deckId=${params.deckId}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error);
        return;
      }
      if (params.token) {
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
  }, [params]);

  if (!view) {
    return (
      <main className="showcase-present">
        <h1>{error || "Loading showcase…"}</h1>
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
