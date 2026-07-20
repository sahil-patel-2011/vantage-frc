/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

import { PRICING_CATALOG, TEAM_TRIAL_DAYS } from "@vantage/billing/catalog";

const c = PRICING_CATALOG;

const faqs = [
  {
    q: "What is Vantage?",
    a: "Invite-only competition ops for FRC teams. Soft-UI hubs cover Competition (scouting, Event Day Command, Alliance Selection Desk), Team (Season Planning), Logistics, Business, Build (CAD agent, Code Coach), and AI (BYOK or credits).",
  },
  {
    q: "What do teams open first?",
    a: "Competition for scouting and Event Day; Alliance Selection Desk for picks; Season Planning on Team; Logistics, Business, and Build as the season needs them.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Match and pit forms keep working when venue Wi-Fi drops; sync resumes when you reconnect.",
  },
  {
    q: "How much does it cost?",
    a: `Free ($0) with your own keys, or buy AI credits anytime. Individual $${c.individual_pro.monthlyUsd}/$${c.individual_max.monthlyUsd}/mo; Team $${c.team_pro.monthlyUsd}/$${c.team_max.monthlyUsd}/mo. Hosted plans include a week team trial (${TEAM_TRIAL_DAYS} days).`,
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
