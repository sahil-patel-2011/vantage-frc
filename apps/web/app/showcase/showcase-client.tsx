"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader, Panel } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Deck = { id: string; title: string; subtitle: string; isDemo: boolean };
type Section = {
  id: string;
  kind: string;
  title: string;
  studentContent: string;
  aiAssistedDraft: string | null;
  approvedContent: string | null;
  evidenceRefs: Array<{ type: string; id: string; label: string }>;
  approvedAt: string | null;
};
type PracticeQuestion = {
  question: string;
  evidenceRefs: Array<{ type: string; id: string; label?: string }>;
};

type View = {
  decks: Deck[];
  sections: Section[];
  selectedId: string;
};

function isShowcaseView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const row = value as { decks?: unknown; sections?: unknown; selectedId?: unknown };
  return Array.isArray(row.decks) && Array.isArray(row.sections) && typeof row.selectedId === "string";
}

async function persistShowcaseSnapshot(orgId: string, data: View): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("showcase", orgId, data);
  } catch {
    // Live showcase already painted; IndexedDB is best-effort.
  }
}

export default function ShowcaseClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [practice, setPractice] = useState<{ id: string; questions: PracticeQuestion[] } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(
    async (deckId?: string) => {
      const selectedHint = deckId ?? viewRef.current?.selectedId ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<View>("showcase", orgId);
        if (!viewRef.current && cached?.data && isShowcaseView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFailureStatus(null);
      try {
        const query = new URLSearchParams({ orgId });
        if (selectedHint) query.set("deckId", selectedHint);
        const response = await fetch(`/api/showcase?${query.toString()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFailureStatus(response.status);
          setMessage(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Could not load Showcase.",
          );
          return;
        }
        const decks =
          data && typeof data === "object" && "decks" in data && Array.isArray(data.decks)
            ? (data.decks as Deck[])
            : [];
        const sections =
          data && typeof data === "object" && "sections" in data && Array.isArray(data.sections)
            ? (data.sections as Section[])
            : [];
        if (!response.ok) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setMessage("Could not refresh Showcase. Showing the last copy on this device.");
            return;
          }
          setFailureStatus(response.status);
          setMessage(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Could not load Showcase.",
          );
          return;
        }
        const next: View = { decks, sections, selectedId: selectedHint };
        setView(next);
        setFromCache(false);
        setCachedAt(null);
        setMessage("");
        await persistShowcaseSnapshot(orgId, next);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Showcase. Showing the last copy on this device.");
          return;
        }
        setMessage("Could not reach the server.");
      }
    },
    [orgId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/showcase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action, ...extra }),
    });
    const data = (await response.json()) as {
      error?: string;
      id?: string;
      url?: string;
      questions?: PracticeQuestion[];
    };
    if (!response.ok) {
      setMessage(data.error ?? "That did not work.");
      return;
    }
    if (data.id && action === "create") {
      setView((current) =>
        current ? { ...current, selectedId: String(data.id) } : current,
      );
      setMessage("Showcase created.");
      await load(String(data.id));
      return;
    }
    if (action === "practice") {
      setPractice({
        id: String(data.id ?? ""),
        questions: Array.isArray(data.questions) ? data.questions : [],
      });
      setMessage("Practice questions from your approved sections.");
      return;
    }
    if (data.url) {
      await navigator.clipboard.writeText(`${location.origin}${data.url}`);
      setMessage("Share link copied — it lasts seven days.");
    } else {
      setMessage("Showcase updated.");
    }
    await load(action === "create" && data.id ? String(data.id) : viewRef.current?.selectedId);
  }

  if (message && !view) {
    const failure = loadFailureCopy(
      classifyLoadFailure({
        status: failureStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Media / Showcase" title="Showcase" />
        <OfflineBanner feature="Showcase" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={failure.kind === "auth" ? "Signed out" : failure.kind === "forbidden" ? "No access" : "Unavailable"}
          badgeTone="setup"
          title={failure.title}
          description={failure.description}
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Media / Showcase" title="Showcase" />
        <OfflineBanner feature="Showcase" fromCache={fromCache} cachedAt={cachedAt} />
        <Panel>
          <p className="app-muted">Loading showcase…</p>
        </Panel>
      </main>
    );
  }

  const selected = view.decks.find((deck) => deck.id === view.selectedId) ?? null;
  const approved = view.sections.filter((section) => section.approvedAt);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Media / Showcase"
        title="Showcase"
        description="Students approve every claim. Advice stays labeled until a student signs off."
      >
        <Button as="a" variant="secondary" href={withOrgHref("/workspace", orgId)}>
          Your team
        </Button>
      </PageHeader>
      <OfflineBanner feature="Showcase" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p role="status" className="app-muted">
          {message}
        </p>
      ) : null}

      {view.decks.length === 0 ? (
        <EmptyState
          soft
          badge="Empty"
          badgeTone="setup"
          title="Create a season story"
          description="Start from process, scouting, CAD, code, reliability, and impact. Add the evidence you already have."
        >
          <Button
            variant="primary"
            type="button"
            onClick={() =>
              void act("create", {
                title: "Season impact",
                subtitle: "Student decisions, evidence, and iteration",
              })
            }
          >
            Create showcase
          </Button>
        </EmptyState>
      ) : (
        <>
          <nav className="showcase-decks" aria-label="Showcase decks">
            {view.decks.map((deck) => (
              <button
                type="button"
                className={view.selectedId === deck.id ? "active" : undefined}
                key={deck.id}
                onClick={() => {
                  setPractice(null);
                  setView({ ...view, selectedId: deck.id, sections: [] });
                  void load(deck.id);
                }}
              >
                {deck.isDemo ? <span>Sample</span> : null}
                <strong>{deck.title}</strong>
              </button>
            ))}
          </nav>

          {selected ? (
            <section className="showcase-editor">
              {view.sections.map((section, index) => (
                <article key={section.id}>
                  <header>
                    <span>
                      {String(index + 1).padStart(2, "0")} / {section.kind}
                    </span>
                    <h2>{section.title}</h2>
                  </header>
                  <label>
                    Your explanation
                    <textarea
                      rows={6}
                      value={section.studentContent}
                      onChange={(event) =>
                        setView({
                          ...view,
                          sections: view.sections.map((item) =>
                            item.id === section.id
                              ? { ...item, studentContent: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  {section.aiAssistedDraft ? (
                    <details>
                      <summary>Advice draft · not approved</summary>
                      <p>{section.aiAssistedDraft}</p>
                    </details>
                  ) : null}
                  <div className="evidence-chips">
                    {section.evidenceRefs.length ? (
                      section.evidenceRefs.map((ref) => (
                        <span key={`${ref.type}:${ref.id}`}>
                          {ref.type} · {ref.label}
                        </span>
                      ))
                    ) : (
                      <small>No matching records yet — add what the team already logged.</small>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    type="button"
                    onClick={() =>
                      void act("update", {
                        sectionId: section.id,
                        studentContent: section.studentContent,
                        approve: true,
                      })
                    }
                  >
                    {section.approvedAt ? "Update approved section" : "Approve section"}
                  </Button>
                </article>
              ))}
            </section>
          ) : null}

          <div className="showcase-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => void act("practice", { deckId: view.selectedId })}
              disabled={!approved.length}
            >
              Start reasoning practice
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                void act("share", {
                  deckId: view.selectedId,
                  sectionIds: approved.map((section) => section.id),
                })
              }
              disabled={!approved.length}
            >
              Copy share link
            </Button>
            {view.selectedId ? (
              <Button
                as="a"
                variant="secondary"
                href={`/showcase/present?orgId=${encodeURIComponent(orgId)}&deckId=${encodeURIComponent(view.selectedId)}`}
                target="_blank"
              >
                Presentation / print
              </Button>
            ) : null}
          </div>
          {view.selectedId && !approved.length ? (
            <small className="app-muted">Approve at least one section to practice or share.</small>
          ) : null}

          {practice ? (
            <section className="showcase-practice" aria-label="Reasoning practice">
              <header>
                <h2>Reasoning practice</h2>
                <Button variant="secondary" type="button" onClick={() => setPractice(null)}>
                  Close practice
                </Button>
              </header>
              {practice.questions.length === 0 ? (
                <p>No approved sections yet, so there is nothing to practice against.</p>
              ) : (
                <ol>
                  {practice.questions.map((item, index) => (
                    <li key={index}>
                      <p>{item.question}</p>
                      <div className="evidence-chips">
                        {item.evidenceRefs?.length ? (
                          item.evidenceRefs.map((ref) => (
                            <span key={`${ref.type}:${ref.id}`}>
                              {ref.type}
                              {ref.label ? ` · ${ref.label}` : ""}
                            </span>
                          ))
                        ) : (
                          <small>No linked evidence for this section.</small>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
