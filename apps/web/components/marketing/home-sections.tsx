import { BuildIllustration, LearnIllustration, PlanIllustration, ScoutIllustration } from "./illustrations";
import { MIcon, type MIconName } from "./marketing-icons";

/**
 * The home page after the hero: the season in four parts, each part in depth, then what a team
 * can trust. Every sentence here was checked against the code or the docs when it was written
 * (docs/FEATURE_MAP.md, docs/SPREADSHEET_MIRROR.md, lib/legal/documents.ts). The scouting-sharing
 * default is stated as plainly as the privacy policy states it.
 */

const SEASON: { id: string; icon: MIconName; title: string; copy: string }[] = [
  { id: "plan", icon: "calendar", title: "Plan", copy: "Tasks, the calendar, hours, money and chat for the whole team." },
  { id: "scout", icon: "clipboard", title: "Scout", copy: "Pits first, then every match from a phone, signal or not." },
  { id: "build", icon: "wrench", title: "Build", copy: "Pull request reviews, Robot Blueprint and the CAD agent." },
  { id: "learn", icon: "cap", title: "Learn", copy: "Steps the app checks, and lessons your team writes." },
];

export function SeasonOverview() {
  return (
    <section className="mx-section" aria-labelledby="mx-season-title">
      <div className="mx-wrap">
        <header className="mx-head is-center">
          <p className="mx-eyebrow">The whole season</p>
          <h2 className="mx-h2" id="mx-season-title">
            Plan. Scout. Build. Learn.
          </h2>
          <p className="mx-lead">
            From kickoff to the last alliance selection, each part of the season has a home, and the whole
            team works from the same record.
          </p>
        </header>
        <ul className="mx-four" data-mx-reveal="">
          {SEASON.map((part) => (
            <li key={part.id}>
              <a href={`#${part.id}`}>
                <span className="mx-icon">
                  <MIcon name={part.icon} size={20} />
                </span>
                <strong>{part.title}</strong>
                <span>{part.copy}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

type Depth = {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: [string, string][];
  link?: { href: string; label: string };
  figure: React.ReactNode;
  flipped?: boolean;
  band?: boolean;
};

const DEPTH: Depth[] = [
  {
    id: "plan",
    eyebrow: "Plan",
    title: "Everyone knows what's next.",
    lead: "Tasks, one team calendar, shop hours, money and chat, with clear rules about who can change what.",
    points: [
      ["Hours with a shop kiosk.", "Scan a card to clock in. Typed-in hours are marked, and only a mentor edits a closed session."],
      ["Two people on every claim.", "The owner picks who manages money, and nobody approves their own reimbursement."],
      ["Tool training, signed off.", "Owners and mentors record who is cleared on each tool."],
      ["Chat that stays with the team.", "By default, a second adult joins any message between an adult and a student."],
    ],
    link: { href: "/features#team", label: "See team tools" },
    figure: <PlanIllustration />,
  },
  {
    id: "scout",
    eyebrow: "Scout",
    title: "Scouting that keeps up with the match.",
    lead: "Start in the pits, then scout every match from a phone. It keeps working when the venue Wi-Fi doesn't.",
    points: [
      ["Pits first.", "Visit the next pit in one tap. Teams nobody has visited come first."],
      ["Quick scout.", "Your next robot from the schedule, one phase at a time, in big tiles."],
      ["Honest receipts.", "Saved on this phone until your team really has the report. Only then: Sent to your team."],
      ["A view for the scouting lead.", "Assign scouts, find robots nobody covered, and settle disagreements."],
    ],
    link: { href: "/features/strategy", label: "Scouting and strategy" },
    figure: <ScoutIllustration />,
    flipped: true,
    band: true,
  },
  {
    id: "build",
    eyebrow: "Build",
    title: "Review the code. Know the robot.",
    lead: "Connect your team's GitHub repository and turn on reviews. Each new pull request gets one, and a map of your robot code feeds the rest of Build.",
    points: [
      ["Reviews that quote the code.", "Every finding must quote a line the pull request adds, or it is dropped. Runs on your team's AI key."],
      ["A code map, without AI.", "Subsystems, commands, CAN IDs and vendor libraries, read from your repository."],
      ["Robot Blueprint.", "Every part of the robot, linked to its CAD, its code and its checks."],
      ["The CAD agent.", "Drive Onshape or Fusion 360 from Claude Code, with manufacturing checks before it builds a part."],
    ],
    link: { href: "/features/code", label: "Code and CAD" },
    figure: <BuildIllustration />,
  },
  {
    id: "learn",
    eyebrow: "Learn",
    title: "New members learn by doing.",
    lead: "Step-by-step tracks for Onshape and for Git and GitHub. Each step explains when to use it, shows an example, and is checked before it counts.",
    points: [
      ["Checked, not just clicked.", "Vantage reads the student's own Onshape part, or their pull request's checks."],
      ["Lead sign-offs.", "Steps software can't see go to a lead. Nobody signs off their own."],
      ["Lessons your team writes.", "Type one in an editor that saves as you go, or upload a PDF, then add practice the app grades."],
    ],
    link: { href: "/features#learn", label: "See learning" },
    figure: <LearnIllustration />,
    flipped: true,
    band: true,
  },
];

export function DepthSections() {
  return (
    <>
      {DEPTH.map((part) => (
        <section
          className={`mx-section${part.band ? " mx-band" : ""}`}
          id={part.id}
          key={part.id}
          aria-labelledby={`mx-${part.id}-title`}
        >
          <div className={`mx-wrap mx-feature${part.flipped ? " is-flipped" : ""}`}>
            <div className="mx-feature-copy">
              <p className="mx-eyebrow">{part.eyebrow}</p>
              <h2 className="mx-h2" id={`mx-${part.id}-title`}>
                {part.title}
              </h2>
              <p className="mx-lead">{part.lead}</p>
              <ul className="mx-points">
                {part.points.map(([title, copy]) => (
                  <li key={title}>
                    <strong>{title}</strong> {copy}
                  </li>
                ))}
              </ul>
              {part.link ? (
                <a className="mx-link" href={part.link.href}>
                  {part.link.label}
                </a>
              ) : null}
            </div>
            {part.figure}
          </div>
        </section>
      ))}
    </>
  );
}

const TRUST: { icon: MIconName; title: string; copy: React.ReactNode }[] = [
  {
    icon: "lock",
    title: "Invite only.",
    copy: "Vantage sets up each team. Owners and mentors invite exact email addresses or share a join code; everyone else joins the waitlist.",
  },
  {
    icon: "users",
    title: "Roles the database keeps.",
    copy: "Owner, admin, team member, and View only for parents and guests, enforced by the database rather than by hiding buttons.",
  },
  {
    icon: "table",
    title: "Your copy in a spreadsheet.",
    copy: "Keep a live copy of your scouting, matches and team records in Google Sheets or Excel, readable even when Vantage is offline.",
  },
  {
    icon: "flag",
    title: "Public data beside your own.",
    copy: "Results from The Blue Alliance and ratings from Statbotics sit next to your scouting. Missing numbers stay blank.",
  },
  {
    icon: "shield",
    title: "Scouting sharing, said plainly.",
    copy: (
      <>
        Structured match scouting is shared with other Vantage teams by default, and an owner can turn it off. Scout
        names, notes and free text are never shared. See the <a className="mx-inline-link" href="/privacy">Privacy Policy</a>.
      </>
    ),
  },
  {
    icon: "key",
    title: "Free. AI is optional.",
    copy: (
      <>
        No subscription and no card. For an assistant, connect your own AI key, Codex or Claude Code.{" "}
        <a className="mx-inline-link" href="/pricing">What it costs</a>
      </>
    ),
  },
];

export function TrustSection() {
  return (
    <section className="mx-section mx-band" id="trust" aria-labelledby="mx-trust-title">
      <div className="mx-wrap">
        <header className="mx-head">
          <p className="mx-eyebrow">Trust and data</p>
          <h2 className="mx-h2" id="mx-trust-title">
            Clear about who sees what.
          </h2>
          <p className="mx-lead">
            Vantage is closed by design. Your team decides who is in, what each person can change, and where a copy of
            your data lives.
          </p>
        </header>
        <ul className="mx-trust" data-mx-reveal="">
          {TRUST.map((item) => (
            <li key={item.title}>
              <span className="mx-icon">
                <MIcon name={item.icon} size={20} />
              </span>
              <strong>{item.title}</strong>
              <p>{item.copy}</p>
            </li>
          ))}
        </ul>
        <div className="mx-devices">
          <p>
            <strong>On every device.</strong> In the browser on phones, tablets and laptops, and as a desktop app for
            Windows and Mac.
          </p>
          <a className="mx-link" href="/desktop">
            About the desktop app
          </a>
        </div>
      </div>
    </section>
  );
}
