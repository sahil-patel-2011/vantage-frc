import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingStrip } from "../../components/marketing/pricing-strip";
import { ScrollReveal } from "../../components/marketing/scroll-reveal";
import { MIcon, type MIconName } from "../../components/marketing/marketing-icons";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "For FRC teams — Vantage",
  description:
    "What mentors, drive team, scouts and business leads each get from Vantage — one invite-only workspace for the whole season, with an AI that teaches students instead of answering for them.",
  path: "/for-teams",
});

const roles: readonly {
  icon: MIconName;
  title: string;
  opens: string;
  copy: string;
  learn: string;
}[] = [
  {
    icon: "users",
    title: "Mentors & coaches",
    opens: "Team · Admin",
    copy:
      "Provision the org, invite exact emails, set per-hub access and AI spend caps. The teaching gates never apply to you — you see results directly.",
    learn:
      "You get the part no dashboard usually gives you: what each student actually predicted, where they took hints, and which mastery claims are waiting for your countersignature.",
  },
  {
    icon: "target",
    title: "Drive & strategy",
    opens: "Competition · Strategy",
    copy:
      "Match predictions, the pick-list desk, the alliance-selection board, defense planning and a one-tap drive-coach briefing — from your scouts plus The Blue Alliance and Statbotics.",
    learn:
      "Before a strategy card reveals its recommendation, the student calls the matchup. The real match grades it, so the driver learns the field, not the tool.",
  },
  {
    icon: "clipboard",
    title: "Scouts & pit",
    opens: "Competition · Scouting",
    copy:
      "Offline match and pit forms, voice notes, QR hand-off, shift balancing, match checklist, repair triage and battery rotation — on a phone, in gloves.",
    learn:
      "A repaired failure won’t file itself. The fixer walks the why-chain against real evidence — the FMEA row, the tuning log, the video timestamp — and writes the cause in their own words.",
  },
  {
    icon: "coins",
    title: "Business leads",
    opens: "Business",
    copy:
      "Budget, purchase orders, the sponsor CRM, the grant pipeline, fundraisers, travel and packing, and the outreach and awards log.",
    learn:
      "Grant and sponsor drafts stay the student’s prose. The agent critiques against the team’s real numbers and impact log rather than writing the letter for them.",
  },
] as const;

const season = [
  {
    step: "1",
    title: "Before the event",
    copy: "Invite members, link your TBA key, publish scout forms, set the active event. Everything downstream inherits it.",
  },
  {
    step: "2",
    title: "At the venue",
    copy: "Scouting, Command and My Day share that event context and keep working when the arena network doesn’t.",
  },
  {
    step: "3",
    title: "Alliance selection",
    copy: "The pick desk uses scout data plus public facts. When the data is thin it says so instead of inventing a ranking.",
  },
  {
    step: "4",
    title: "After",
    copy: "Debriefs, exports, the season report — then rollover turns this season’s decisions into next season’s lessons.",
  },
] as const;

export default function ForTeamsPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <ScrollReveal />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-eyebrow">For teams</p>
          <h1>Everyone on the team, and the students most of all.</h1>
          <p>
            Mentors provision access; students open Competition, Team, Build, Business and AI. Everyone shares one
            event context and one set of real numbers — and the AI is built so the students end the season able to do
            the work themselves.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Request access
            </a>
            <a className="button secondary" href="/#how-it-works">
              See how it works
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="roles-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">Four jobs</p>
              <h2 id="roles-title">Who opens what.</h2>
              <p>Four jobs on a real team. Each one gets the tool, and the student on it gets taught.</p>
            </header>
            <ul className="lux-role-grid" data-reveal>
              {roles.map((role) => (
                <li key={role.title}>
                  <span className="lux-card-icon">
                    <MIcon name={role.icon} />
                  </span>
                  <span className="mk-tag">{role.opens}</span>
                  <strong>{role.title}</strong>
                  <p>{role.copy}</p>
                  <p className="lux-role-learn">
                    <b>Call your shot: </b>
                    {role.learn}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-season" aria-labelledby="season-title">
          <div className="lux-content">
            <header className="lux-section-head" data-reveal>
              <p className="lux-eyebrow">A competition weekend</p>
              <h2 id="season-title">What happens when.</h2>
              <p>Concrete moments on a real team timeline — not a numbered marketing strip.</p>
            </header>
            <ol className="lux-season-steps lux-season-steps-4" data-reveal>
              {season.map((item) => (
                <li key={item.title}>
                  <b>Step {item.step}</b>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <PricingStrip headingId="for-teams-pricing-title" />

        <section className="lux-waitlist" id="waitlist">
          <div data-reveal>
            <p className="lux-eyebrow">Closed beta</p>
            <h2>Request access.</h2>
            <p>
              Vantage is invite-only while it is in closed beta. A platform admin provisions each team with a verified
              owner, and owners and admins invite exact emails from there. Joining the waitlist does not create an
              account.
            </p>
          </div>
          <div data-reveal className="mk-waitlist-links">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/workflow">
              Walk the workflow
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
