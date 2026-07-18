"use client";

import type { BusinessView } from "../../lib/business-portal";
import { PIPELINE_STAGE_LABELS } from "../../lib/sponsor-pipeline";

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

/** Soft-UI glanceable goal vs actual + stage pipeline for Business Overview. */
export function FundraisingGlance({
  view,
  onOpenSponsors,
}: {
  view: BusinessView;
  onOpenSponsors: () => void;
}) {
  const progress = view.fundraisingProgress;
  const maxStageValue = Math.max(1, ...progress.stages.map((stage) => stage.valueCents || stage.count * 100));
  const attainment = percent(progress.actualCents, progress.goalCents || 1);
  const tone =
    progress.percentOfGoal >= 100 ? "good" : progress.percentOfGoal >= 50 ? "blue" : progress.goalCents > 0 ? "warn" : "neutral";

  return (
    <section className="app-card soft-panel biz-fundraising-glance" aria-label="Fundraising goal versus actual">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Season fundraising</span>
          <h2>Goal vs actual</h2>
          <p className="app-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Org-local cash + grants only — never mixed with other teams.
          </p>
        </div>
        <span className={`biz-badge ${tone}`}>{progress.percentOfGoal}% of goal</span>
      </header>

      <div className="biz-fundraising-stats soft-snapshot-grid">
        <div>
          <strong className="accent">{money(progress.actualCents)}</strong>
          <span>actual in</span>
        </div>
        <div>
          <strong>{money(progress.goalCents)}</strong>
          <span>season goal</span>
        </div>
        <div>
          <strong>{money(progress.remainingCents)}</strong>
          <span>remaining</span>
        </div>
      </div>

      <div className="soft-track biz-fundraising-track" aria-label={`${attainment}% of fundraising goal`}>
        <i style={{ width: `${attainment}%` }} />
      </div>
      <footer className="biz-fundraising-split">
        <span>{money(progress.actualCashCents)} sponsors</span>
        <span>{money(progress.grantIncomeCents)} grants</span>
        <span>{money(progress.pledgedPipelineCents)} pledged</span>
      </footer>

      <div className="biz-stage-pipeline" aria-label="Sponsor stage pipeline">
        <header>
          <span className="biz-overline">Stage pipeline</span>
          <button className="app-button secondary" type="button" onClick={onOpenSponsors}>
            Open CRM
          </button>
        </header>
        <ol className="biz-stage-strip">
          {progress.stages.map((stage) => {
            const bar = Math.max(stage.count > 0 ? 12 : 4, percent(stage.valueCents || stage.count, maxStageValue));
            return (
              <li key={stage.stage} className={stage.count ? "has-partners" : ""}>
                <span className="biz-stage-label">{PIPELINE_STAGE_LABELS[stage.stage]}</span>
                <span className="biz-stage-count">{stage.count}</span>
                <i className="biz-stage-bar" style={{ height: `${bar}%` }} />
                <strong>{stage.valueCents > 0 ? money(stage.valueCents) : "—"}</strong>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
