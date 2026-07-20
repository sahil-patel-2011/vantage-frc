"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui";
import { HELP_ARTICLES, filterHelpArticles, helpArticleHref } from "../../lib/help";
import "./help.css";

export default function HelpClient() {
  const [query, setQuery] = useState("");
  const articles = useMemo(() => filterHelpArticles(query), [query]);

  return (
    <main className="module-page help-page soft-gate">
      <PageHeader
        breadcrumbs="Settings / App manual"
        title="How to use this app"
        description="Searchable Soft-UI manual — hubs, island, Home widgets, scouting offline, TBA, BYOK, Event Day, Business/Media, and AI. Also available from Cmd+K."
      >
        <a className="app-button secondary" href="/support">
          Support tickets
        </a>
      </PageHeader>

      <label className="help-search" htmlFor="help-search-input">
        <span className="eyebrow">Search the manual</span>
        <input
          id="help-search-input"
          type="search"
          value={query}
          placeholder="e.g. island, Edit Home, TBA, Automode, credits…"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {articles.length === 0 ? (
        <p className="help-empty app-muted" role="status">
          No topics match “{query.trim()}”. Try island, scouting, BYOK, or credits — or open Support tickets.
        </p>
      ) : (
        <ul className="help-article-list">
          {articles.map((article) => (
            <li key={article.id}>
              <a className="help-article-card" href={helpArticleHref(article.slug)}>
                <span className="eyebrow">{article.category}</span>
                <strong>{article.title}</strong>
                <span>{article.summary}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length < 2 ? (
        <p className="help-hint app-muted">
          {HELP_ARTICLES.length} topics in-repo — no CMS. Empty product surfaces stay honest until real TBA/scout data exists.
        </p>
      ) : null}
    </main>
  );
}
