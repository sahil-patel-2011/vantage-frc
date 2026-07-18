/** Landing-page FAQ — visible accordion + FAQPage JSON-LD for SEO rich results and GEO. */

const faqs = [
  {
    q: "What is Vantage?",
    a: "Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It brings scouting (with trust signals and offline QR), live match data, win/loss prediction, an FRC Assistant, strategy, CAD↔strategy workflows, Event Day / My Day, knowledge, logistics, sponsorship/grants/orders, product hubs, and robot-code review into one shared, source-attributed event context. Broader AI tool-graph routing is still shipping and labeled as such.",
  },
  {
    q: "What is the FRC Assistant?",
    a: "The FRC Assistant helps with competition ops and intel inside your active event—strategy, matchups, predicting what other teams tend to do from history, and robot capabilities. It grounds replies in TBA/Statbotics plus your scouted observations, with sources labeled. It does not invent fake dashboards when your workspace is empty.",
  },
  {
    q: "How does scouting connect to everything else?",
    a: "Scouting is integrated, not a silo. Offline match and pit forms sync into attributed team facts that feed predictions, strategy playbooks, pick lists, live match boards, and Assistant context—so drive team and strategy work from the same event.",
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
    a: "The complete non-AI competition core is free, with bring-your-own-key or local AI. Paid plans: Individual Pro $49/mo ($40 API), Individual Max $79/mo ($68 API), Team Pro $149/mo ($130 pooled API), Team Max $299/mo ($260 pooled API). Usage is debited at provider list rates with no Vantage markup; after the included allowance, usage hard-stops unless you buy Usage Credits or enable PAYG. Access ($35/mo) unlocks managed routing without a large included bucket. There is no per-seat student pricing.",
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
