/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

const faqs = [
  {
    q: "What is Vantage?",
    a: "An invite-only workspace for FRC teams. Scouting, event day, and season ops in one login.",
  },
  {
    q: "What do we open first?",
    a: "Competition: Command, Scouting, and Strategy. Team for calendar and chat. Everything else stays in All tools until you need it.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Match and pit forms keep working when venue Wi-Fi drops. They sync when you reconnect.",
  },
  {
    q: "How much does it cost?",
    a: "Free with your own AI keys, or buy credits. Individual and Team plans add hosted AI. Full prices are on the pricing page.",
  },
  {
    q: "Is team data private?",
    a: "Yes. Access is invite-only. Each team only sees its own workspace.",
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
