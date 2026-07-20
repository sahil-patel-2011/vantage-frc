/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

import { PRICING_CATALOG, TEAM_TRIAL_DAYS, hostedApiSavingsCopy } from "@vantage/billing/catalog";

const c = PRICING_CATALOG;

const faqs = [
  {
    q: "What is Vantage?",
    a: "Vantage is invite-only competition operations software for FRC teams. Soft-UI hubs cover Competition (Scouting, Command, My Day, Strategy, Alliance Selection Desk), Team (including Season Planning), Business, Build (CAD agent, Code Coach), and AI (Assistant + /team/ai-keys). Surfaces stay empty until real data exists.",
  },
  {
    q: "What do teams open first?",
    a: "Competition hub for Scouting, Command, and My Day; Alliance Selection Desk for picks; Season Planning on Team; then Business and Build when the season needs them. Free teams add AI keys at /team/ai-keys.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Match and pit forms keep working when venue Wi-Fi drops; sync resumes with attribution when you reconnect.",
  },
  {
    q: "How much does it cost?",
    a: `Free competition core with bring-your-own-key or local AI. Paid: Individual Pro $${c.individual_pro.monthlyUsd}/mo, Max $${c.individual_max.monthlyUsd}/mo; Team Pro $${c.team_pro.monthlyUsd}/mo, Max $${c.team_max.monthlyUsd}/mo. ${hostedApiSavingsCopy()} Hard stop after the included hosted window unless Credits or PAYG. Week team trial: ${TEAM_TRIAL_DAYS} days.`,
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
