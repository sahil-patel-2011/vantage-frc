"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PageHeader, ToolStrip, Button } from "../../components/ui";
import { openFeedback } from "../../lib/feedback/feedback-open";
import { tourReplayHref } from "../../lib/tour/tour-start";
import {
  HELP_ARTICLES,
  filterHelpArticles,
  helpArticleHref,
  helpArticlesByCategory,
  helpCategoryLabel,
  type HelpArticle,
  type HelpCategoryId,
} from "../../lib/help";
import "../product-hub.css";
import "./help.css";

type HelpView = "topics" | "sections";

export type HelpClientProps = {
  /**
   * Renders the section-by-section guide as a second view (used by /docs).
   * /help keeps the categorised article index and cross-links to /docs.
   */
  sectionGuide?: ReactNode;
};

function readInitialView(hasGuide: boolean): HelpView {
  if (!hasGuide || typeof window === "undefined") return "topics";
  return new URLSearchParams(window.location.search).get("view") === "sections"
    ? "sections"
    : "topics";
}

/** Deep links like /docs?q=hub+access and /help?q=sponsors prefill the search. */
function readInitialQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function ArticleCard({ article }: { article: HelpArticle }) {
  return (
    <a className="help-article-card" href={helpArticleHref(article.slug)}>
      <span className="eyebrow">{helpCategoryLabel(article.category)}</span>
      <strong>{article.title}</strong>
      <span>{article.summary}</span>
    </a>
  );
}

export default function HelpClient({ sectionGuide }: HelpClientProps = {}) {
  const hasGuide = Boolean(sectionGuide);
  const [view, setView] = useState<HelpView>("topics");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<HelpCategoryId | "all">("all");
  // The team in the address, so "Take the tour again" opens that team's Home.
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    setView(readInitialView(hasGuide));
    const q = readInitialQuery();
    if (q) setQuery(q);
    setTeamId(new URLSearchParams(window.location.search).get("orgId"));
  }, [hasGuide]);

  const searching = query.trim().length >= 2;
  const ranked = useMemo(() => filterHelpArticles(query), [query]);
  const groups = useMemo(
    () =>
      helpArticlesByCategory().filter(
        (group) => categoryFilter === "all" || group.category.id === categoryFilter,
      ),
    [categoryFilter],
  );

  const showTopics = !hasGuide || view === "topics";

  return (
    <main className="module-page help-page soft-gate">
      <PageHeader
        // No breadcrumb: the top bar already has the back button and says where this is.
        title={hasGuide ? "App manual" : "Help"}
        description={
          hasGuide
            ? "Guides for every part of Vantage."
            : "Find an answer or get in touch."
        }
      >
        <nav className="product-hub-related" aria-label="Related account tools">
          <a href="/whats-new">What’s new</a>
          <a href="/support">Support tickets</a>
          {/* Opens the same dialog as the round bug button; /report-bug is the page it falls back to. */}
          <a
            href="/report-bug"
            onClick={(event) => {
              if (openFeedback()) event.preventDefault();
            }}
          >
            Send feedback
          </a>
          {/* Home with ?tour=replay: the tour starts there whatever it remembers. */}
          <a href={tourReplayHref(teamId)}>Take the tour again</a>
          {!hasGuide ? (
            <a href="/docs?view=sections">App manual</a>
          ) : null}
        </nav>
      </PageHeader>

      {hasGuide ? (
        <ToolStrip
          aria-label="Manual views"
          value={view}
          onChange={(next) => setView(next as HelpView)}
          visibleCount={4}
          items={[
            { id: "topics", label: "Topics" },
            { id: "sections", label: "Section by section" },
          ]}
        />
      ) : null}

      {showTopics ? (
        <>
          <label className="help-search" htmlFor="help-search-input">
            <span className="eyebrow">Search the manual</span>
            <input
              id="help-search-input"
              type="search"
              value={query}
              placeholder="e.g. library, pricing, scouting…"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {!searching ? (
            <div className="help-cats" role="group" aria-label="Filter by category">
              <button
                type="button"
                className="help-cat-chip"
                aria-pressed={categoryFilter === "all"}
                onClick={() => setCategoryFilter("all")}
              >
                All topics
              </button>
              {helpArticlesByCategory().map(({ category, articles }) => (
                <button
                  key={category.id}
                  type="button"
                  className="help-cat-chip"
                  aria-pressed={categoryFilter === category.id}
                  onClick={() =>
                    setCategoryFilter(categoryFilter === category.id ? "all" : category.id)
                  }
                >
                  {category.label}
                  <i aria-hidden="true">{articles.length}</i>
                </button>
              ))}
            </div>
          ) : null}

          {searching ? (
            ranked.length === 0 ? (
              <p className="help-empty app-muted" role="status">
                No topics match “{query.trim()}”. Try library, pricing, or scouting — or
                open Support tickets.
              </p>
            ) : (
              <ul className="help-article-list" aria-label="Search results">
                {ranked.map((article) => (
                  <li key={article.id}>
                    <ArticleCard article={article} />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="help-groups">
              {groups.map(({ category, articles }) => (
                <section
                  key={category.id}
                  className="help-group"
                  aria-labelledby={`help-cat-${category.id}`}
                >
                  <header>
                    <h2 id={`help-cat-${category.id}`}>{category.label}</h2>
                    <p className="app-muted">{category.blurb}</p>
                  </header>
                  <ul className="help-article-list">
                    {articles.map((article) => (
                      <li key={article.id}>
                        <ArticleCard article={article} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {!searching ? (
            <div className="help-crosslink">
              <div>
                <strong>
                  {hasGuide ? "Prefer task-by-task articles?" : "Prefer a guided walkthrough?"}
                </strong>
                <p className="app-muted">
                  {hasGuide
                    ? "This Topics view and /help are the same searchable article index."
                    : "The section-by-section guide walks every hub — what it is, why, when in the season, and the steps."}
                </p>
              </div>
              <Button as="a" variant="secondary"
                href={hasGuide ? "/help" : "/docs?view=sections"}
              >
                {hasGuide ? "Open Help" : "Open the guide"}
              </Button>
            </div>
          ) : null}

          {!searching ? (
            <p className="help-hint app-muted">
              {HELP_ARTICLES.length} topics in-repo — no CMS. Empty product surfaces stay honest
              until real TBA/scout data exists.
            </p>
          ) : null}
        </>
      ) : (
        sectionGuide
      )}
    </main>
  );
}
