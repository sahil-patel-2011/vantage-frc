"use client";

import { PageHeader, Button } from "../../components/ui";
import { openFeedback } from "../../lib/feedback/feedback-open";
import { helpTopicFor, type HelpArticle } from "../../lib/help";
import "./help.css";

export default function HelpArticleClient({ article }: { article: HelpArticle }) {
  const topic = helpTopicFor(article);
  return (
    <main className="module-page help-page help-article-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/help">Help center</a>
            {" › "}
            <a href={`/help?topic=${topic.id}`}>{topic.label}</a>
          </>
        }
        title={article.title}
        description={article.summary}
      >
        <div className="help-article-actions">
          <Button as="a" variant="primary" href={article.relatedHref}>
            Open in app
          </Button>
        </div>
      </PageHeader>

      <div className="help-article-body">
        {article.sections.map((section) => (
          <section key={section.heading} className="help-section">
            <h2>{section.heading}</h2>
            <ul>
              {section.body.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <nav className="help-article-footer" aria-label="Still need help?">
        <a href={`/help?topic=${topic.id}`}>More in {topic.label}</a>
        <a href="/support">Contact support</a>
        {/* The same dialog as the round button in the corner; /report-bug if it isn't there. */}
        <a
          href="/report-bug"
          onClick={(event) => {
            if (openFeedback("bug")) event.preventDefault();
          }}
        >
          Send feedback
        </a>
      </nav>
    </main>
  );
}
