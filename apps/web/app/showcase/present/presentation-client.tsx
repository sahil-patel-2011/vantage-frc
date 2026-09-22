"use client";
import "../../product-styles";
import { useEffect, useState } from "react";

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

type ApiSection = {
  id: string;
  kind: string;
  title: string;
  approvedContent: string;
  approvedAt: string | null;
  evidenceRefs: View["sections"][number]["evidenceRefs"];
  aiAssistedDraft: string | null;
};

/**
 * Why nothing is on screen, in words — never the server's.
 *
 * Opened without a deck, this used to request `deckId=undefined` — the literal
 * word — and render whatever came back as its heading, which was Postgres
 * saying 'invalid input syntax for type uuid: "undefined"'. A missing deck is
 * now caught before any request, and a failed one shows a sentence a person can
 * act on, with the server's message kept to a line underneath.
 */
type Problem = { title: string; detail: string | null };

export default function ShowcasePresentation({
  params,
}: {
  params: { token?: string; orgId?: string; deckId?: string };
}) {
  const [view, setView] = useState<View | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    // Neither a share link nor a deck to present: nothing to ask for.
    if (!params.token && !(params.orgId && params.deckId)) {
      setProblem({ title: "Choose a deck to present", detail: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = params.token
          ? await fetch(`/api/showcase/public?token=${encodeURIComponent(params.token)}`)
          : await fetch(
              `/api/showcase?orgId=${encodeURIComponent(params.orgId!)}&deckId=${encodeURIComponent(params.deckId!)}`,
            );
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setProblem({
            title: params.token ? "This share link could not be opened" : "This deck could not be opened",
            detail: typeof body?.error === "string" ? body.error : null,
          });
          return;
        }
        if (params.token) {
          setView(body as View);
          return;
        }
        setView({
          deck: { title: "Season Impact", subtitle: "Approved student evidence", isDemo: false },
          sections: ((body.sections ?? []) as ApiSection[])
            .filter((section) => section.approvedAt)
            .map((section) => ({
              ...section,
              content: section.approvedContent,
              aiAssisted: Boolean(section.aiAssistedDraft),
            })),
        });
      } catch {
        if (!cancelled) setProblem({ title: "Could not reach Vantage", detail: "Check the connection and reload." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (!view) {
    return (
      <main className="showcase-present">
        <h1>{problem ? problem.title : "Loading showcase…"}</h1>
        {problem?.detail ? <p>{problem.detail}</p> : null}
        {problem ? (
          <p>
            <a href={params.orgId ? `/showcase?orgId=${encodeURIComponent(params.orgId)}` : "/showcase"}>
              Open Showcase
            </a>
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main className="showcase-present">
      <header>
        <div>
          <span>VANTAGE / SEASON IMPACT</span>
          <h1>{view.deck.title}</h1>
          <p>{view.deck.subtitle}</p>
        </div>
        {view.deck.isDemo && <strong>Sample deck · not a real season</strong>}
        <button onClick={() => print()}>Print evidence packet</button>
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
