"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/icon";
import { withOrgHref } from "../../lib/nav/product-nav";
import { openFeedback } from "../../lib/feedback/feedback-open";
import { tourReplayHref } from "../../lib/tour/tour-start";
import {
  HELP_TOPICS,
  helpArticleHref,
  helpTopicArticles,
  helpTopicFor,
  isHelpTopicId,
  popularHelpArticles,
  searchHelpCenter,
  type HelpArticle,
  type HelpTopicId,
} from "../../lib/help";
import "./help.css";

/** One article as a row: title, one line, and its topic when it could be any. */
function ArticleRow({ article, showTopic }: { article: HelpArticle; showTopic: boolean }) {
  return (
    <li>
      <a className="hc-article" href={helpArticleHref(article.slug)}>
        <span className="hc-article-copy">
          <strong>{article.title}</strong>
          <span>{article.summary}</span>
          {showTopic ? <small>{helpTopicFor(article).label}</small> : null}
        </span>
        <Icon name="chevron" className="hc-chevron" />
      </a>
    </li>
  );
}

/** Keep ?q= and ?topic= in the address so a link or a reload lands in the same place. */
function writeAddress(next: { q?: string; topic?: HelpTopicId | null }) {
  const url = new URL(window.location.href);
  if (next.q !== undefined) {
    if (next.q.trim()) url.searchParams.set("q", next.q.trim());
    else url.searchParams.delete("q");
  }
  if (next.topic !== undefined) {
    if (next.topic) url.searchParams.set("topic", next.topic);
    else url.searchParams.delete("topic");
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The Help center. One question ("How can we help?") with one search field that searches the
 * manual as you type; seven topics as cards; popular articles, or the chosen topic's articles;
 * and "Still need help?" at the bottom (support, feedback, the tour, what's new).
 */
export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<HelpTopicId | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    const requested = params.get("topic");
    setTopic(isHelpTopicId(requested) ? requested : null);
    setOrgId(params.get("orgId"));
  }, []);

  const results = useMemo(() => searchHelpCenter(query), [query]);
  const searching = query.trim().length >= 2;
  const chosen = HELP_TOPICS.find((entry) => entry.id === topic) ?? null;
  const articles = chosen ? helpTopicArticles(chosen.id) : popularHelpArticles();

  function chooseTopic(next: HelpTopicId | null) {
    setTopic(next);
    writeAddress({ topic: next });
    // The list below changes; take keyboard and screen-reader users to it.
    if (next) requestAnimationFrame(() => listHeadingRef.current?.focus());
  }

  return (
    <main className="module-page help-page help-center soft-gate">
      <header className="hc-hero">
        <p className="breadcrumbs hc-crumb">Help center</p>
        <h1>How can we help?</h1>
        <div className="hc-search">
          <Icon name="search" />
          <label className="hc-sr" htmlFor="help-search-input">Search the manual</label>
          <input
            id="help-search-input"
            type="search"
            value={query}
            placeholder="Search the manual"
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => {
              setQuery(event.target.value);
              writeAddress({ q: event.target.value });
            }}
          />
          {query ? (
            <button
              type="button"
              className="hc-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                writeAddress({ q: "" });
                document.getElementById("help-search-input")?.focus();
              }}
            >
              <Icon name="x" />
            </button>
          ) : null}
        </div>
      </header>

      {searching ? (
        <section className="hc-section" aria-labelledby="hc-results-title">
          <h2 id="hc-results-title" className="hc-section-title">
            {results.length ? `${results.length} ${results.length === 1 ? "article" : "articles"} for “${query.trim()}”` : "No articles found"}
          </h2>
          {results.length ? (
            <ul className="hc-articles" aria-label="Search results">
              {results.map((article) => <ArticleRow key={article.id} article={article} showTopic />)}
            </ul>
          ) : (
            <p className="hc-empty" role="status">
              Nothing in the manual matches “{query.trim()}”. Try a shorter word, pick a topic below, or ask us.
            </p>
          )}
        </section>
      ) : null}

      <section className="hc-section" aria-labelledby="hc-topics-title" hidden={searching && results.length > 0}>
        <h2 id="hc-topics-title" className="hc-section-title">Browse by topic</h2>
        <ul className="hc-topics">
          {HELP_TOPICS.map((entry) => {
            const count = helpTopicArticles(entry.id).length;
            const selected = entry.id === topic;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="hc-topic"
                  aria-pressed={selected}
                  onClick={() => chooseTopic(selected ? null : entry.id)}
                >
                  <i className="hc-topic-icon" aria-hidden="true"><Icon name={entry.icon} /></i>
                  <span className="hc-topic-copy">
                    <strong>{entry.label}</strong>
                    <span>{entry.blurb}</span>
                  </span>
                  <small className="hc-topic-count">{count} {count === 1 ? "article" : "articles"}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {!searching ? (
        <section className="hc-section" aria-labelledby="hc-list-title">
          <div className="hc-section-head">
            <h2 id="hc-list-title" className="hc-section-title" ref={listHeadingRef} tabIndex={-1}>
              {chosen ? chosen.label : "Popular articles"}
            </h2>
            {chosen ? (
              <button type="button" className="hc-quiet" onClick={() => chooseTopic(null)}>
                Show popular articles
              </button>
            ) : null}
          </div>
          <ul className="hc-articles">
            {articles.map((article) => <ArticleRow key={article.id} article={article} showTopic={!chosen} />)}
          </ul>
        </section>
      ) : null}

      <section className="hc-section hc-still" aria-labelledby="hc-still-title">
        <h2 id="hc-still-title" className="hc-section-title">Still need help?</h2>
        <div className="hc-still-grid">
          <a className="hc-still-card" href={withOrgHref("/support", orgId)}>
            <i className="hc-topic-icon" aria-hidden="true"><Icon name="chat" /></i>
            <span>
              <strong>Contact support</strong>
              <span>Ask a question. We answer by email, and you can follow it under Support.</span>
            </span>
          </a>
          {/* The same dialog as the round button in the corner; /report-bug if it isn't there. */}
          <a
            className="hc-still-card"
            href="/report-bug"
            onClick={(event) => {
              if (openFeedback("bug")) event.preventDefault();
            }}
          >
            <i className="hc-topic-icon" aria-hidden="true"><Icon name="bolt" /></i>
            <span>
              <strong>Send feedback</strong>
              <span>Something broken, or an idea? Tell us in a few words.</span>
            </span>
          </a>
        </div>
        <p className="hc-quiet-links">
          {/* Home with ?tour=replay: the tour starts there whatever it remembers. */}
          <a href={tourReplayHref(orgId)}>Take the tour again</a>
          <a href="/docs?view=sections">App manual, section by section</a>
          <a href="/whats-new">What’s new</a>
        </p>
      </section>
    </main>
  );
}
