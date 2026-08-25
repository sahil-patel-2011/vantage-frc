/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

const faqs = [
  {
    q: "What is Vantage?",
    a: "Invite-only operations software for FRC teams. Scouting, event day, alliance selection, CAD, robot code, business, and metered AI share one login.",
  },
  {
    q: "What do we open first?",
    a: "Competition: Event day, Scouting, Strategy, and Pit. Team for calendar, chat, and playbook. Build for CAD and Code. AI for Assistant. Everything else is under those hubs or All tools.",
  },
  {
    q: "Does scouting work offline?",
    a: "Yes. Match and pit forms stay on the tablet. QR handoff and pit mesh move entries between devices. They sync when you reconnect. Photos compress before upload.",
  },
  {
    q: "Where does strategy data come from?",
    a: "The Blue Alliance cache, Statbotics where configured, and your scout entries. Alliance desk and pick tools stay empty until those exist. Vantage does not invent EPA or win rates.",
  },
  {
    q: "How does CAD and code work?",
    a: "CAD runs a confirmed brief, then allowlisted operations on Onshape (hosted) or Fusion (desktop relay). Code Coach reviews patterns locally; Bugbot quotes your source and never pushes diffs.",
  },
  {
    q: "How much does it cost?",
    a: "Free with your own AI keys, or platform Groq/OpenRouter when the host has keys. Individual and Team add hosted AI. Full prices are on the pricing page. Hard cutoffs — no surprise overage.",
  },
  {
    q: "Is team data private?",
    a: "Yes. Access is invite-only. Each team only sees its own workspace. Postgres row-level security is the tenancy model. Exports never include API keys.",
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
        <p className="lux-eyebrow">Questions</p>
        <h2 id="faq-title">Questions teams actually ask</h2>
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
