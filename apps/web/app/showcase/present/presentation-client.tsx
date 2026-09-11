"use client";

import "../../product-styles";
import { useEffect, useState } from "react";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";

type View = {
  deck: { title: string; subtitle: string | null; isDemo: boolean };
  sections: Array<{
    id: string;
    kind: string;
    title: string;
    content: string;
    aiAssisted: boolean;
    evidenceRefs: Array<{ type: string; id: string; label: string }>;
  }>;
};

function kindLabel(kind: string): string {
  switch (kind) {
    case "problem":
      return "Problem";
    case "process":
      return "Process";
    case "scouting":
      return "Scouting";
    case "cad":
      return "CAD";
    case "code":
      return "Code";
    case "reliability":
      return "Reliability";
    case "outreach":
      return "Outreach";
    default:
      return kind;
  }
}

export default function ShowcasePresentation({
  params,
}: {
  params: { token?: string; orgId?: string; deckId?: string };
}) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = params.token
          ? await fetch(`/api/showcase/public?token=${encodeURIComponent(params.token)}`, {
              cache: "no-store",
              signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
            })
          : await fetch(
              `/api/showcase?orgId=${encodeURIComponent(params.orgId ?? "")}&deckId=${encodeURIComponent(params.deckId ?? "")}`,
              { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
            );
        const data = (await response.json()) as {
          error?: string;
          deck?: View["deck"];
          sections?: Array<{
            id: string;
            kind: string;
            title: string;
            approvedAt: string | null;
            approvedContent: string;
            evidenceRefs: View["sections"][number]["evidenceRefs"];
            aiAssistedDraft: string | null;
          }>;
        } & View;
        if (!response.ok) {
          setError(data.error ?? "Showcase unavailable");
          return;
        }
        if (params.token) {
          setView(data as View);
          return;
        }
        setView({
          deck: {
            title: "Season Impact",
            subtitle: "Approved student evidence",
            isDemo: false,
          },
          sections: (data.sections ?? [])
            .filter((section) => section.approvedAt)
            .map((section) => ({
              id: section.id,
              kind: section.kind,
              title: section.title,
              content: section.approvedContent,
              aiAssisted: Boolean(section.aiAssistedDraft),
              evidenceRefs: section.evidenceRefs,
            })),
        });
      } catch {
        setError("Could not load this showcase.");
      }
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
          <span>Season showcase</span>
          <h1>{view.deck.title}</h1>
          <p>{view.deck.subtitle}</p>
        </div>
        {view.deck.isDemo ? <strong>Sample deck · not a real season</strong> : null}
        <button type="button" onClick={() => print()}>
          Print evidence packet
        </button>
      </header>
      {view.sections.map((section, index) => (
        <section key={section.id}>
          <span>
            {String(index + 1).padStart(2, "0")} · {kindLabel(section.kind)}
          </span>
          <h2>{section.title}</h2>
          <p>{section.content}</p>
          {section.aiAssisted ? <em>Advice summary · student approved</em> : null}
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
