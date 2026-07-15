/** Landing-page FAQ — visible accordion + FAQPage JSON-LD for SEO rich results and GEO. */

const faqs = [
  {
    q: "What is Vantage?",
    a: "Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It brings scouting, live match data, win/loss prediction, strategy, CAD, and robot-code review into one shared, source-attributed event context.",
  },
  {
    q: "Who is Vantage for?",
    a: "FRC teams — coaches, mentors, drive teams, and students who need one trustworthy place to capture data and make competition decisions together.",
  },
  {
    q: "Does Vantage work offline at competitions?",
    a: "Yes. Scouting and event operations are offline-first: forms keep working when venue Wi-Fi drops and sync automatically when the connection returns.",
  },
  {
    q: "Where does the match data come from?",
    a: "Live reference data is sourced from The Blue Alliance and Statbotics, cached, deduped, and freshness-stamped. Official results always take priority over estimates.",
  },
  {
    q: "How much does Vantage cost?",
    a: "The complete non-AI competition core is free, with bring-your-own-key or local AI. Paid individual ($30–$50/mo) and team ($100–$200/mo) plans fund managed AI with published credits and hard spending controls. There is no per-seat student pricing.",
  },
  {
    q: "Is our team's data private?",
    a: "Yes. Membership is invite-only and every team's work is isolated by row-level database policies. AI drafts stay behind human approval, and Vantage never deploys code to a robot on its own.",
  },
  {
    q: "How is Vantage different from a scouting spreadsheet?",
    a: "A spreadsheet holds one slice of the season. Vantage connects the whole loop — scout, predict, strategize, build, present — in one context where every number carries its source, so you can tell real data from a guess.",
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
    <section className="faq-section" aria-labelledby="faq-title">
      <header>
        <span className="section-id">QUESTIONS</span>
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
