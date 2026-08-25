/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

const faqs = [
  {
    q: "What is Vantage?",
    a: "An invite-only workspace for one FRC team's whole season — scouting, strategy, event day, build, team ops and the business side — with an AI that does real work and teaches while it does it.",
  },
  {
    q: "What does “call your shot” mean?",
    a: "A student has to commit a prediction before a result is revealed, and the real math, the CAD kernel or the actual match grades it. The AI then explains the gap. Mentors are never gated.",
  },
  {
    q: "Does the AI just do the students' work for them?",
    a: "It is built not to. The agent narrates every operation, demos one instance and hands the work back, and its help fades per student as their skills graph fills. Deadline mode exists, and every skip is logged as a mentor-visible debt.",
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
    a: "Free with your own AI keys, including free provider tiers, or buy credits. Individual and Team plans add hosted AI. Full prices are on the pricing page.",
  },
  {
    q: "Is team data private?",
    a: "Yes. Access is invite-only, and every request is filtered by Postgres row-level security scoped to your team. Each team only sees its own workspace. There are no ads, no ad cookies, and your content is never sold.",
  },
  {
    q: "We're a school — who owns the content, and what do you train on?",
    a: "Your team owns its content and can export it. We do use AI-feature activity — prompts, the context sent with them, responses and tool traces — to train and evaluate our own in-house models. That is stated plainly in the Privacy Policy, which is the document to read before your district signs off.",
  },
  {
    q: "How is student contact handled?",
    a: "An unsupervised adult–student direct message cannot be created: the data model requires a second adult. Edits and deletes are tombstoned rather than erased, and a full transcript exports in one click.",
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
      <header className="lux-section-head">
        <p className="lux-eyebrow">Questions</p>
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
