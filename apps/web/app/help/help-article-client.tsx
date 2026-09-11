"use client";

import { PageHeader, Button } from "../../components/ui";
import { helpCategoryLabel, type HelpArticle } from "../../lib/help";
import "./help.css";

export default function HelpArticleClient({ article }: { article: HelpArticle }) {
  return (
    <main className="module-page help-page help-article-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href="/help">Help centre</a>
            {" / "}
            {article.title}
          </>
        }
        title={article.title}
        description={article.summary}
      >
        <div className="help-article-actions">
          <Button as="a" variant="primary" href={article.relatedHref}>
            Open in app
          </Button>
          <Button as="a" variant="secondary" href="/help">
            All topics
          </Button>
        </div>
      </PageHeader>

      <span className="eyebrow help-article-cat">{helpCategoryLabel(article.category)}</span>

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

      <nav className="help-article-footer" aria-label="Help navigation">
        <a href="/help">← Help centre</a>
        <a href="/docs?view=sections">Section-by-section guide</a>
        <a href="/support">Support tickets</a>
      </nav>
    </main>
  );
}
