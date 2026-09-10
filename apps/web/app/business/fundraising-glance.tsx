"use client";

import { BusinessRelated } from "../../components/business-related";
import { EmptyState, Button } from "../../components/ui";
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
  sponsorsAllowed = true,
}: {
  view: BusinessView;
  onOpenSponsors: () => void;
  sponsorsAllowed?: boolean;
}) {
  const progress = view.fundraisingProgress;
  const hasGoal = progress.goalCents > 0;
  const hasActual = progress.actualCents > 0 || progress.pledgedPipelineCents > 0;
  const partnerCount = progress.stages.reduce((sum, stage) => sum + stage.count, 0);
  const maxStageValue = Math.max(1, ...progress.stages.map((stage) => stage.valueCents || stage.count * 100));
  const attainment = hasGoal ? percent(progress.actualCents, progress.goalCents) : null;
  const tone =
    attainment != null && attainment >= 100
      ? "good"
      : attainment != null && attainment >= 50
        ? "blue"
        : hasGoal
          ? "warn"
          : "neutral";

  if (!hasGoal && !hasActual && partnerCount === 0) {
    return (
      <EmptyState
        soft
        className="biz-fundraising-glance"
        badge="Get started"
        title="No season fundraising goal yet"
        description={
          sponsorsAllowed
            ? "Set a budget goal, then add sponsors, grants, or fundraiser events."
            : "Set a budget goal, then add grants or fundraiser events."
        }
      >
        <BusinessRelated
          orgId={view.orgId}
          include={
            sponsorsAllowed
              ? ["budget", "sponsors", "grants", "fundraisers", "orders"]
              : ["budget", "grants", "fundraisers", "orders"]
          }
          ariaLabel="Fundraising glance setup links"
        />
      </EmptyState>
    );
  }

  return (
    <section className="app-card soft-panel biz-fundraising-glance" aria-label="Fundraising goal versus actual">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Season fundraising</span>
          <h2>{hasGoal ? "Goal vs actual" : "Recorded inflows"}</h2>
          <p className="app-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Org-local cash + grants only.
          </p>
        </div>
        <span className={`biz-badge ${tone}`}>
          {attainment != null ? `${attainment}% of goal` : "Set a season goal"}
        </span>
      </header>

      <div className="biz-fundraising-stats soft-snapshot-grid">
        <div>
          <strong className="accent">{money(progress.actualCents)}</strong>
          <span>actual in</span>
        </div>
        <div>
          <strong>{hasGoal ? money(progress.goalCents) : "—"}</strong>
          <span>season goal</span>
        </div>
        <div>
          <strong>{hasGoal ? money(progress.remainingCents) : money(progress.pledgedPipelineCents)}</strong>
          <span>{hasGoal ? "remaining" : "pledged"}</span>
        </div>
      </div>

      {hasGoal && attainment != null ? (
        <div className="soft-track biz-fundraising-track" aria-label={`${attainment}% of fundraising goal`}>
          <i style={{ width: `${attainment}%` }} />
        </div>
      ) : (
        <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
          Progress bar appears after you set a fundraising goal on Budget. Actual in only counts recorded
          {sponsorsAllowed ? " sponsor cash and grant awards." : " grant awards and fundraiser cash."}
        </p>
      )}
      <footer className="biz-fundraising-split">
        {sponsorsAllowed ? <span>{money(progress.actualCashCents)} sponsors</span> : null}
        <span>{money(progress.grantIncomeCents)} grants</span>
        {sponsorsAllowed ? <span>{money(progress.pledgedPipelineCents)} pledged</span> : null}
      </footer>

      <BusinessRelated
        orgId={view.orgId}
        include={
          sponsorsAllowed
            ? ["fundraisers", "sponsors", "grants", "orders"]
            : ["fundraisers", "grants", "orders"]
        }
        ariaLabel="Fundraising glance related links"
      />

      {sponsorsAllowed ? (
        <div className="biz-stage-pipeline" aria-label="Sponsor stage pipeline">
          <header>
            <span className="biz-overline">Stage pipeline</span>
            <Button variant="secondary" type="button" onClick={onOpenSponsors}>
              Open CRM
            </Button>
          </header>
          {partnerCount === 0 ? (
            <EmptyState
              soft
              title="Sponsor pipeline is empty"
              description="Partners you add appear by stage. Amounts stay blank until you record ask, pledge, or cash."
            />
          ) : (
            <ol className="biz-stage-strip">
              {progress.stages.map((stage) => {
                const bar = Math.max(
                  stage.count > 0 ? 12 : 4,
                  percent(stage.valueCents || stage.count, maxStageValue),
                );
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
          )}
        </div>
      ) : null}
    </section>
  );
}
