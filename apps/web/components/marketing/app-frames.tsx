/**
 * Public Soft-UI frames of the signed-in app.
 * Hero uses the live Kickoff brief. Never invents scores, ratings, or team counts.
 */

import { computeGameBrief, gameBriefStatusBadge } from "../../lib/game-brief/compute-game-brief";

function AppChrome({ title, crumbs }: { title: string; crumbs: string }) {
  return (
    <div className="mk-mock-chrome">
      <span className="mk-mock-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <strong>Vantage · {title}</strong>
      <b>{crumbs}</b>
    </div>
  );
}

function AppIsland({ island }: { island: "Home" | "Compete" | "Team" | "Build" }) {
  return (
    <nav className="mk-mock-rail" aria-hidden="true">
      {(["Home", "Compete", "Team", "Build"] as const).map((item) => (
        <span key={item} className={item === island ? "is-active" : undefined}>
          {item}
        </span>
      ))}
    </nav>
  );
}

/** Hero: Kickoff + Home — the screens a new member actually opens. */
export function HeroProductPanel() {
  const brief = computeGameBrief();
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-chrome">
        <span className="mk-mock-dots">
          <i />
          <i />
          <i />
        </span>
        <strong>Vantage · Kickoff</strong>
        <b>Build / Kickoff</b>
      </div>

      <div className="mk-mock-body">
        <div className="mk-mock-main">
          <div className="mk-mock-tabs">
            <span className="is-active">Kickoff</span>
            <span>Home</span>
          </div>
          <article className="mk-mock-card">
            <header>
              <strong>
                {brief.gameName} {brief.year}
              </strong>
              <span>{gameBriefStatusBadge(brief.status)}</span>
            </header>
            <p className="mk-mock-empty">{brief.headline}</p>
            {brief.priorSeason ? (
              <p className="mk-mock-empty">
                Last season you can study now — {brief.priorSeason.gameName} {brief.priorSeason.year}
              </p>
            ) : null}
            <p className="mk-mock-shot">
              <span className="mk-app-primary">Ask about this game</span>
            </p>
          </article>
          <article className="mk-mock-card">
            <header>
              <strong>What to do now</strong>
              <span>Home</span>
            </header>
            <dl className="mk-mock-rows">
              <div>
                <dt>Scout this match</dt>
                <dd>Needs setup</dd>
              </div>
              <div>
                <dt>Learn CAD</dt>
                <dd>CAD Video Tutor</dd>
              </div>
              <div>
                <dt>Ask AI</dt>
                <dd>Connect Claude Code</dd>
              </div>
            </dl>
          </article>
        </div>
        <div className="mk-mock-rail">
          {(["Home", "Compete", "Team", "Build"] as const).map((item) => (
            <span key={item} className={item === "Build" ? "is-active" : undefined}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <footer className="mk-mock-note">
        Interface preview — the real Kickoff brief, not a team&apos;s scores.
      </footer>
    </div>
  );
}

export type ProductFrameId = "scouting" | "cad" | "ask-ai";

export function ProductFrame({ id }: { id: ProductFrameId }) {
  switch (id) {
    case "scouting":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Scouting" crumbs="Competition / Scouting" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>Choose your team</strong>
                  <span>Needs setup</span>
                </header>
                <p className="mk-mock-empty">
                  Match and pit forms stay on this tablet when venue Wi-Fi dies. They stay blank until you pick a
                  team.
                </p>
                <p className="mk-mock-shot">
                  <span className="mk-app-primary">Choose your team</span>
                </p>
              </article>
            </div>
            <AppIsland island="Compete" />
          </div>
        </div>
      );
    case "cad":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Learn CAD" crumbs="Build / Learn CAD" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>CAD Video Tutor</strong>
                  <span>Cast iron</span>
                </header>
                <p className="mk-mock-empty">
                  Saddle Bracket on Onshape. Mass and spin come from the document — you never type them.
                </p>
                <p className="mk-mock-shot">
                  <span className="mk-app-primary">Open the lesson</span>
                </p>
              </article>
            </div>
            <AppIsland island="Build" />
          </div>
        </div>
      );
    case "ask-ai":
      return (
        <div className="mk-mock mk-app-frame" aria-hidden="true">
          <AppChrome title="Chat" crumbs="Ask AI" />
          <div className="mk-mock-body">
            <div className="mk-mock-main">
              <article className="mk-mock-card">
                <header>
                  <strong>Connect Claude Code</strong>
                  <span>Needs setup</span>
                </header>
                <p className="mk-mock-empty">
                  A mentor signs in on one computer and pairs it here. Ask AI then runs on that plan — no API key.
                </p>
                <p className="mk-mock-shot">
                  <span className="mk-app-primary">Connect Claude Code</span>
                </p>
              </article>
            </div>
            <AppIsland island="Home" />
          </div>
        </div>
      );
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

export const MARKETING_APP_FRAMES: { id: ProductFrameId; title: string; copy: string }[] = [
  {
    id: "scouting",
    title: "Scouting",
    copy: "Offline match and pit forms. Needs setup until you choose a team. Coverage stays blank until you scout.",
  },
  {
    id: "cad",
    title: "Learn CAD",
    copy: "CAD Video Tutor, then a grade from the real Onshape part.",
  },
  {
    id: "ask-ai",
    title: "Ask AI",
    copy: "Claude Code is the path that does not ask a student for an API key.",
  },
];
