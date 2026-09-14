"use client";

import { computeGameBrief, gameAskHref } from "../../lib/game-brief/compute-game-brief";
import { Button } from "../../components/ui";

function BriefLists({
  whatWeKnow,
  scoutFirst,
  designQuestions,
}: {
  whatWeKnow: readonly string[];
  scoutFirst: readonly string[];
  designQuestions: readonly string[];
}) {
  return (
    <div className="kick-brief-grid">
      <section>
        <h3>What the manual named</h3>
        <ul>
          {whatWeKnow.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Scout first</h3>
        <ul>
          {scoutFirst.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Design questions</h3>
        <ul>
          {designQuestions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function GameBriefSection({ orgId, seasonYear }: { orgId: string; seasonYear: number }) {
  const brief = computeGameBrief(seasonYear);
  const askHref = gameAskHref(orgId, seasonYear);

  return (
    <section className="app-card soft-panel kick-brief" aria-labelledby="kick-brief-title">
      <header>
        <span className={`app-badge ${brief.status === "published" ? "good" : "setup"}`}>
          {brief.status === "published" ? "From the manual" : "Needs setup"}
        </span>
        <h2 id="kick-brief-title">
          {brief.gameName} {brief.year}
        </h2>
        <p>{brief.headline}</p>
      </header>

      {brief.scoringLabels.length > 0 ? (
        <p className="app-muted">
          Scoring on the sheet: {brief.scoringLabels.join(" · ")}
        </p>
      ) : null}

      <BriefLists
        whatWeKnow={brief.whatWeKnow}
        scoutFirst={brief.scoutFirst}
        designQuestions={brief.designQuestions}
      />

      {brief.priorSeason ? (
        <div className="kick-brief-prior">
          <h3>
            Last season you can study now — {brief.priorSeason.gameName} {brief.priorSeason.year}
          </h3>
          <BriefLists
            whatWeKnow={brief.priorSeason.brief.whatWeKnow}
            scoutFirst={brief.priorSeason.brief.scoutFirst}
            designQuestions={brief.priorSeason.brief.designQuestions}
          />
        </div>
      ) : null}

      <div className="kick-brief-actions">
        <Button as="a" variant="primary" href={askHref}>
          Ask about this game
        </Button>
      </div>
    </section>
  );
}
