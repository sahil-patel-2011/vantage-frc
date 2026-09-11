"use client";

// Sustainability early-warning panel for the Business overview.
//
// Evidence (docs/archive/COMMUNITY_DEMAND_RND.md): single-sponsor dependence and the year-2-to-3 grant
// cliff are the statistically documented death track for FRC teams, and nobody tells a team it
// is on that track while there is still time to act. This panel is that sentence.
//
// It fetches its own data so a slow or missing sustainability read can never delay or break
// the budget numbers next to it. Every string it renders comes from the model in
// lib/sustainability/risk.ts, which cites the figure behind each factor — this file adds no
// numbers of its own.

import { useEffect, useState } from "react";
import { Badge, Button } from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { levelLabel, topFactors } from "../../lib/sustainability/risk";
import type { SustainabilityView } from "../../lib/sustainability/compute-sustainability";
import type { SustainabilityLevel } from "../../lib/sustainability/types";

function levelTone(level: SustainabilityLevel): BadgeTone {
  if (level === "at-risk") return "danger";
  if (level === "watch") return "info";
  if (level === "stable") return "good";
  return "setup";
}

export default function SustainabilityPanel({
  orgId,
  seasonYear,
}: {
  orgId: string;
  seasonYear?: number;
}) {
  const [view, setView] = useState<SustainabilityView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ orgId });
    if (seasonYear) query.set("season", String(seasonYear));
    fetch(`/api/sustainability?${query.toString()}`)
      .then(async (response) => {
        const data = (await response.json()) as SustainabilityView | { error?: string };
        if (cancelled) return;
        if (!response.ok || !("status" in data)) {
          setFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, seasonYear]);

  // A failed read shows nothing rather than a reassuring "stable" the data never supported.
  if (failed || !view) return null;

  if (view.status === "setup_required") {
    return (
      <section className="biz-sustain" aria-labelledby="biz-sustain-title">
        <header>
          <h3 id="biz-sustain-title">Sustainability</h3>
          <Badge tone="setup">Not enough recorded</Badge>
        </header>
        <p className="app-muted">{view.message}</p>
      </section>
    );
  }

  const { assessment } = view;
  const factors = topFactors(assessment, 2);

  return (
    <section className="biz-sustain" aria-labelledby="biz-sustain-title">
      <header>
        <h3 id="biz-sustain-title">Sustainability</h3>
        <Badge tone={levelTone(assessment.level)}>{levelLabel(assessment.level)}</Badge>
      </header>

      {assessment.level === "unknown" ? (
        <>
          <p className="app-muted">
            We will not score a team from thin data. Record these and this panel starts telling
            you something true:
          </p>
          <ul className="biz-sustain-todo">
            {assessment.missingInputs.map((input) => (
              <li key={input}>{input}</li>
            ))}
          </ul>
          <Button as="a" variant="ghost"
            href={`/business?orgId=${encodeURIComponent(view.orgId)}&tab=finance`}
          >
            Open the finance desk
          </Button>
        </>
      ) : (
        <>
          <ul className="biz-sustain-factors">
            {factors.map((factor) => (
              <li key={factor.key} className={`severity-${factor.severity}`}>
                <strong>{factor.headline}</strong>
                <span className="biz-sustain-evidence">{factor.evidence}</span>
                <span className="biz-sustain-action">{factor.nextAction}</span>
                {factor.href ? (
                  <a href={factor.href}>Act on this</a>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="biz-sustain-foot app-muted">
            {assessment.totals.fundingSourceCount} funding{" "}
            {assessment.totals.fundingSourceCount === 1 ? "source" : "sources"} recorded for{" "}
            {view.seasonYear}. Computed from your rows only — never an estimate.
          </p>
        </>
      )}
    </section>
  );
}
