import { PUBLIC_SIGNUP_DATE_LABEL } from "@vantage/core/public-signup";

/** Landing-page FAQ — short answers + FAQPage JSON-LD. Each answer was checked against the code. */

function faqAnchor(question: string) {
  return `faq-${question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const faqs = [
  {
    q: "What is Vantage?",
    a: "A shared workspace for FRC teams: scouting and strategy, tasks and the calendar, hours, money, chat, robot code and CAD, and learning for new members. Everyone on the team signs in to the same place and sees what their role allows.",
  },
  {
    q: "How does a team get in?",
    a: `Access is closed. Vantage sets up each team and its owner, and the owner or a mentor invites members by exact email address or shares a join code. New teams join the waitlist; team signup is planned from ${PUBLIC_SIGNUP_DATE_LABEL}. Vantage is for people aged 13 and older.`,
  },
  {
    q: "Does scouting work offline?",
    a: "Yes, once the forms are ready. Open scouting while you have a connection, and match and pit reports then save on the phone when the signal drops and upload when it is back. The phone says Sent to your team only after your team has the report. QR transfer can move reports between phones. Signing in, connecting services and other server-backed features still need a connection.",
  },
  {
    q: "What do parents see?",
    a: "Parents and guests can be given View only access: they can look at what the team shares with them but can't change anything, and the database enforces that. Owners can also limit which parts of Vantage a student or guest can open.",
  },
  {
    q: "Is our team's data private?",
    a: "Team records are separated by team and protected by roles. One thing is shared by default: structured match scouting is available to other signed-in Vantage teams, credited to your team, without scout names, notes or free text. An owner or admin can turn that off. The Privacy Policy covers operator access, service providers and retention.",
  },
  {
    q: "Can we keep our own copy of our data?",
    a: "Yes. An owner can keep a live copy of the team's records, including scouting, matches, hours and the budget, in Google Sheets or Excel. The copy stays readable even when Vantage is offline. Authorized members can also export data.",
  },
  {
    q: "How much does it cost?",
    a: "Nothing. There is no subscription and no card. AI is optional: connect your team's own provider key, a personal key, or your own Codex or Claude Code on a paired computer. Those providers set their own prices and limits.",
  },
  {
    q: "We already scout with a spreadsheet. Why switch?",
    a: "Keep the spreadsheet if you like it: Vantage can write a copy of your scouting to one. What Vantage adds is everything around it: pit-first scouting on phones that works without signal, a lead who can see which robots still need a scout, and the pick list, match plans, tasks and budget in the same place.",
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
    <section className="mx-section" id="faq" aria-labelledby="faq-title">
      <div className="mx-wrap">
        <header className="mx-head is-center">
          <p className="mx-eyebrow">Questions</p>
          <h2 className="mx-h2" id="faq-title">
            Questions teams ask.
          </h2>
        </header>
        <div className="mx-faq-list">
          {faqs.map((f) => (
            <details key={f.q} id={faqAnchor(f.q)}>
              <summary>
                {f.q}
                <i aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </section>
  );
}
