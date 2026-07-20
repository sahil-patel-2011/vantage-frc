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
        breadcrumbs="Settings / Help"
        title="Help"
        description="Short tutorials for Soft-UI — island, Home widgets, scouting offline, BYOK, Event Day, alliance/season, and credits. Search also works from Cmd+K."
      >
        <a className="app-button secondary" href="/support">
          Support tickets
        </a>
      </PageHeader>

      <label className="help-search" htmlFor="help-search-input">
        <span className="eyebrow">Search tutorials</span>
        <input
          id="help-search-input"
          type="search"
          value={query}
          placeholder="e.g. island, Edit Home, Automode, credits…"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {articles.length === 0 ? (
        <p className="help-empty app-muted" role="status">
          No tutorials match “{query.trim()}”. Try island, scouting, BYOK, or credits — or open Support tickets.
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
          {HELP_ARTICLES.length} tutorials in-repo — no CMS. Cmd+K or /search also jump here when you type a topic.
        </p>
      ) : null}
    </main>
  );
}
