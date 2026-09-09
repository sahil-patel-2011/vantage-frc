/** Landing-page FAQ — short answers + FAQPage JSON-LD. */

function faqAnchor(question: string) {
  return `faq-${question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const faqs = [
  {
    q: "What is Vantage?",
    a: "One workspace for an FRC team: learning tracks for CAD and programming, calendar and tasks, files, chat, scouting, strategy, CAD, robot code, money and outreach. One login for every student and mentor.",
  },
  {
    q: "What does a new student see first?",
    a: "Home, then a learning track: set up the laptop, learn Onshape from the first sketch to a graded part, learn Git and the robot code workflow — with an assistant in the guide that knows your team's own material. Nobody needs fifty accounts to start.",
  },
  {
    q: "Where is everything?",
    a: "Four places: Team (calendar, chat, people, work, playbook), Build (kickoff, CAD, code, robot), Competition (event day, scouting, strategy, pit) and Business (money, sponsors, grants, outreach). Search finds any tool by name.",
  },
  {
    q: "What does the AI actually do?",
    a: "It is a helper, not the product. Ask AI on any page answers from your team's data and the public record — match predictions, strategy questions, design help, writing — and says when it does not know. The team profile it starts from is built from The Blue Alliance and Statbotics the day you join.",
  },
  {
    q: "Does scouting work offline?",
    a: "Yes. Match and pit forms stay on the tablet, QR handoff and pit mesh move entries between devices, and everything syncs when you reconnect.",
  },
  {
    q: "What is the assembly manual?",
    a: "Point it at your Onshape assembly and it produces a step-by-step build book — parts, cuts, drill and tap sizes, pictures — like a LEGO manual for your robot. Anything the CAD does not specify is marked for you to confirm rather than guessed.",
  },
  {
    q: "How much does it cost?",
    a: "Everything is included on every plan. Free uses your own AI keys or a small hosted allowance; Pro, Pro+ and Max add more hosted AI with a hard cutoff so there is never a surprise bill. Full prices are on the pricing page.",
  },
  {
    q: "Is team data private?",
    a: "Yes. Access is invite-only, each team sees only its own workspace, and a member's personal files are private even from mentors. You can export everything at any time.",
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
          <details key={f.q} className="faq-item" id={faqAnchor(f.q)}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </section>
  );
}
