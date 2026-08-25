import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE } from "../../lib/legal";
import { LEGAL_LAST_UPDATED, splitOnContactEmail, TERMS_OF_SERVICE } from "../../lib/legal/documents";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import "../legal.css";

/** Renders body text, turning the contact address into a mailto link. */
function LegalText({ text }: { text: string }) {
  return (
    <>
      {splitOnContactEmail(text).map((run, index) =>
        run.kind === "email" ? (
          <a href={`mailto:${run.value}`} key={index}>
            {run.value}
          </a>
        ) : (
          <span key={index}>{run.value}</span>
        )
      )}
    </>
  );
}

export const metadata: Metadata = marketingPageMetadata({
  title: "Terms of Service — Vantage",
  description:
    "The rules for using Vantage: who may hold an account, what a team owns, acceptable use for a youth robotics program, youth-protection limits, AI, and billing.",
  path: "/terms",
});

export default function TermsPage() {
  const doc = TERMS_OF_SERVICE;
  return (
    <div className="marketing-site marketing-lux legal-page">
      <SiteHeader />
      <main className="legal-doc" id="top">
        <header className="legal-doc-head">
          <p className="legal-kicker">Legal</p>
          <h1>{doc.title}</h1>
          <p className="legal-doc-summary">{doc.summary}</p>
          <p className="legal-doc-meta">
            <span>Last updated {LEGAL_LAST_UPDATED}</span>
            <span>Effective {LEGAL_EFFECTIVE_DATE}</span>
            <span>Version {LEGAL_DOC_VERSION}</span>
          </p>
        </header>

        <p className="legal-doc-notice">
          <strong>Read with the Privacy Policy.</strong>
          These Terms cover the rules; the <a href="/privacy">Privacy Policy</a> covers what we collect. The{" "}
          <a href="#youth-protection">youth-protection section</a> states both what the product enforces and what it
          cannot promise. The governing-law section is an unfinished placeholder pending legal review.
        </p>

        <nav className="legal-toc" aria-label="Sections of these terms">
          <h2>On this page</h2>
          <ol>
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="legal-body">
          {doc.sections.map((section) => (
            <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-h`}>
              <h2 id={`${section.id}-h`}>
                {section.heading}
                <a className="legal-anchor" href={`#${section.id}`} aria-label={`Link to ${section.heading}`}>
                  #
                </a>
              </h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-p${index}`}>
                  <LegalText text={paragraph} />
                </p>
              ))}
              {section.list ? (
                <ul>
                  {section.list.map((item, index) => (
                    <li key={`${section.id}-l${index}`}>
                      <LegalText text={item} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <p>
            <a className="legal-back-to-top" href="#top">
              Back to top
            </a>{" "}
            <a className="legal-back-to-top" href="/pricing">
              See current plans and prices
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
