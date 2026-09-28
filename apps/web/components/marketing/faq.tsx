/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

function faqAnchor(question: string) {
  return `faq-${question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const faqs = [
  { q: "What is Vantage?", a: "Vantage is a shared workspace for FRC teams. It brings scouting and strategy together with team coordination, robot development, learning and business records. Home connects your personal work to Competition, Team, Build and Business." },
  { q: "What does a new student see first?", a: "After accepting an invitation and completing onboarding, members start on Home. The team controls their role and access. Vantage is for people aged 13 and older; new teams currently join the waitlist." },
  { q: "Where is everything?", a: "The menu organizes Home, Competition, Team, Build and Business on phones and computers. The bottom island holds personal shortcuts and Apps. Logistics is inside Team; scouting, team profiles, strategy and the pit are inside Competition." },
  { q: "Do we have to use AI?", a: "No. Scouting collection, task management, calendars, inventory and finance do not require an AI connection. AI assistants need a supported provider key or your own paired Codex account. Codex connections belong to the person, and their credentials stay on their device." },
  { q: "We already scout with an app or a spreadsheet. Why switch?", a: "Vantage puts scouting reports, team profiles, pick lists and match planning next to the rest of your team's work. You can evaluate that workflow before changing your tools. Onshape, Fusion and GitHub remain separate specialist environments connected to Vantage." },
  { q: "Does scouting work offline?", a: "Prepare your forms while online. Supported scouting forms save entries on the device when the connection drops; queued reports upload when you reconnect. QR transfer supports exchanging scouting reports. Signing in, connecting services and other server-backed features still need a connection." },
  { q: "What is the assembly manual?", a: "Build-book tools organize assembly information from connected CAD. Generated instructions need your team's review for completeness, dimensions, materials and safety. A connection does not replace CAD expertise or engineering checks." },
  { q: "How much does it cost?", a: "Vantage currently has no subscription charge and requires no card. Optional AI uses personal Codex or a personal or team provider key. External providers set their own subscription charges, usage limits and prices." },
  { q: "Is team data private?", a: "Team roles and permissions control access inside the app. Structured match scouting is shared with other signed-in Vantage teams by default, including past reports; an owner or admin can turn sharing off. Scout identities, free text and private notes are excluded. Necessary operator access and service providers are described in the Privacy Policy. PostgreSQL is the live database, with copies in the operator's Google account, including encrypted sensitive recovery records. AI prompts, supplied context and responses may be used to improve Vantage's models unless the team opts out; an owner or admin manages that preference. See the Privacy Policy for retention and withdrawal details." },
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
          <details key={f.q} className="faq-item" id={faqAnchor(f.q)}>
            <summary>
              {f.q}
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
