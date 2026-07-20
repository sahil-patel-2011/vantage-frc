/** Landing-page FAQ — visible accordion + FAQPage JSON-LD for SEO rich results and GEO. */

import { PRICING_CATALOG, TEAM_TRIAL_DAYS } from "@vantage/billing/catalog";

const c = PRICING_CATALOG;

const faqs = [
  {
    q: "What is Vantage?",
    a: "Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. Soft-UI hubs organize Competition, Team, Business, Build, and AI. Available surfaces include custom scouting form builder, opt-in voice notes, offline QR scouting with trust signals, Event Day / My Day, strategy and Soft-UI pick tools, Business hub sponsorship/grants/orders, knowledge, logistics, FRC Assistant, and robot-code review. CAD connectors are Setup required. Broader AI tool-graph routing is still Shipping. Every number stays source-attributed; empty workspaces stay empty.",
  },
  {
    q: "What is the FRC Assistant?",
    a: "The FRC Assistant helps with competition ops and intel inside your active event—strategy, matchups, predicting what other teams tend to do from history, and robot capabilities. It grounds replies in TBA/Statbotics plus your scouted observations, with sources labeled. It does not invent fake dashboards when your workspace is empty.",
  },
  {
    q: "How does scouting connect to everything else?",
    a: "Scouting is integrated, not a silo. Owners publish versioned custom match/pit forms; scouts can attach opt-in voice notes without overwriting fields. Offline forms and QR handoffs sync into attributed team facts that feed predictions, Soft-UI strategy/pick tools, live match boards, and Assistant context—so drive team and strategy work from the same event.",
  },
  {
    q: "Who is Vantage for?",
    a: "FRC teams — coaches, mentors, drive teams, and students who need one trustworthy place to capture data and make competition decisions together.",
  },
  {
    q: "Does Vantage work offline at competitions?",
    a: "Yes. Scouting and event operations are offline-first: forms keep working when venue Wi-Fi drops, QR handoffs move scout assignments between devices, and sync resumes automatically when the connection returns.",
  },
  {
    q: "Where does the match data come from?",
    a: "Live reference data is sourced from The Blue Alliance and Statbotics, cached, deduped, and freshness-stamped. Official results always take priority over estimates. Your team's scout observations are separate, attributed records.",
  },
  {
    q: "How much does Vantage cost?",
    a: `The complete non-AI Soft-UI competition core is free, with bring-your-own-key or local AI. Paid plans: Individual Pro $${c.individual_pro.monthlyUsd}/mo ($${c.individual_pro.includedAllowanceUsd} API), Individual Max $${c.individual_max.monthlyUsd}/mo ($${c.individual_max.includedAllowanceUsd} API), Team Pro $${c.team_pro.monthlyUsd}/mo ($${c.team_pro.includedAllowanceUsd} pooled API), Team Max $${c.team_max.monthlyUsd}/mo ($${c.team_max.includedAllowanceUsd} pooled API). Usage is debited at provider list rates with no Vantage markup; after the included allowance, usage hard-stops unless you buy Usage Credits or enable PAYG. Access ($${c.access.monthlyUsd}/mo) unlocks managed routing without a large included bucket. Week team trial: ${TEAM_TRIAL_DAYS} days / $${c.team_trial.includedAllowanceUsd} API. There is no per-seat student pricing.`,
  },
  {
    q: "Is our team's data private?",
    a: "Yes. Membership is invite-only and every team's work is isolated by row-level database policies. AI drafts stay behind human approval, and Vantage never deploys code to a robot on its own.",
  },
  {
    q: "How is Vantage different from a scouting spreadsheet?",
    a: "A spreadsheet holds one slice of the season. Vantage connects the whole loop — scout, predict, assist, strategize, build, present — in one context where every number carries its source, so you can tell real data from a guess.",
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
        <h2 id="faq-title">Frequently asked.</h2>
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
