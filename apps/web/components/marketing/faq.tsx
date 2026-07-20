/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

import { PRICING_CATALOG, TEAM_TRIAL_DAYS, hostedApiSavingsCopy } from "@vantage/billing/catalog";

const c = PRICING_CATALOG;

const faqs = [
  {
    q: "What is Vantage?",
    a: "Soft-UI competition ops for FRC: Scouting, Event Day, Strategy / Pick desk, Season planning, CAD agent, Team & Business, and metered FRC Assistant. Empty until real data exists.",
  },
  {
    q: "What do teams open first?",
    a: "Scouting (offline + voice), Event Day Command / My Day, Strategy and Alliance Selection Desk, then logistics and Business when the season needs them.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Match/pit forms keep working when venue Wi-Fi drops; sync resumes with attribution when you reconnect.",
  },
  {
    q: "How much does it cost?",
    a: `Free competition core with BYOK/local AI. Paid: Individual Pro $${c.individual_pro.monthlyUsd}/mo, Max $${c.individual_max.monthlyUsd}/mo; Team Pro $${c.team_pro.monthlyUsd}/mo, Max $${c.team_max.monthlyUsd}/mo. ${hostedApiSavingsCopy()} Hard stop after included allowance unless Credits or PAYG. Week trial: ${TEAM_TRIAL_DAYS} days.`,
  },
  {
    q: "Is team data private?",
    a: "Invite-only orgs with row-level isolation. AI stays behind human approval; Vantage never deploys code to a robot.",
  },
];

export function FAQ() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section className="faq-section lux-faq" aria-labelledby="faq-title">
      <header className="lux-section-head">
        <h2 id="faq-title">FAQ</h2>
      </header>
      <div className="faq-list">
        {faqs.map((f) => (
          <details key={f.q} className="faq-item">
            <summary>
              <span>{f.q}</span>
              <i aria-hidden="true" />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </section>
  );
}
