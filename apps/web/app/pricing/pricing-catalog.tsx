"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
  formatCatalogUsd,
  hostedApiSavingsCopy,
  teamCommitRangeCopy,
} from "@vantage/billing/catalog";

type PlanCard = {
  code: string;
  name: string;
  price: string;
  period?: string;
  signal: string;
  featured?: boolean;
  flag?: string;
  features: string[];
  note?: string;
};

const access = PRICING_CATALOG.access;
const individualPro = PRICING_CATALOG.individual_pro;
const individualMax = PRICING_CATALOG.individual_max;
const teamPro = PRICING_CATALOG.team_pro;
const teamMax = PRICING_CATALOG.team_max;
const teamRange = teamCommitRangeCopy();
const hostedSavings = hostedApiSavingsCopy();

const individualPlans: PlanCard[] = [
  {
    code: "free",
    name: "Free",
    price: "$0",
    signal: "Your keys · local OK",
    features: [
      "Soft-UI competition core: scouting, strategy, Event Day / Pit ops",
      "Bring your own key or a local OpenAI-compatible relay",
      "Native product surfaces—not a bolted-on chat wrapper",
      "No managed AI routing; no silent paid-model spend",
    ],
  },
  {
    code: "individual_pro",
    name: "Individual Pro",
    price: formatCatalogUsd(individualPro.monthlyUsd),
    signal: "Hosted AI included",
    featured: true,
    flag: "Popular",
    features: [
      "Managed AI — less than typical BYOK",
      "Native Soft-UI: scouting trust, strategy, CAD review",
      "Private workspace with clear hard usage cutoffs",
      "Add Usage Credits or PAYG when you need more",
    ],
  },
  {
    code: "individual_max",
    name: "Individual Max",
    price: formatCatalogUsd(individualMax.monthlyUsd),
    signal: "More capacity · priority",
    features: [
      "Higher hosted AI capacity and concurrency than Pro",
      "Priority Soft-UI features and scenario sweeps",
      "Same native product—built in, not bolted on",
      "Credits or PAYG after the included hosted window",
    ],
  },
];

const teamPlans: PlanCard[] = [
  {
    code: "team_pro",
    name: "Team Pro",
    price: formatCatalogUsd(teamPro.monthlyUsd),
    signal: "Native features + hosted models",
    featured: true,
    flag: "Most teams",
    features: [
      "Managed AI for the org — cheaper than own keys",
      "Shared Soft-UI: Event Day, Pit, logistics, automations",
      "Org budget, member, and feature controls",
      "Pooled Credits or PAYG when the team needs more",
    ],
  },
  {
    code: "team_max",
    name: "Team Max",
    price: formatCatalogUsd(teamMax.monthlyUsd),
    signal: "Full org · advanced AI",
    features: [
      "Highest hosted capacity and concurrency for the org",
      "Advanced CAD, strategy, code review, and admin Soft-UI",
      "Everything built in natively across the season",
      "Optional credit packs when you outgrow the plan window",
    ],
  },
];

const creditPackOptions = [
  {
    value: "team_max",
    label: `Team Max · $${teamMax.monthlyUsd}/mo`,
  },
  { value: "credits_100", label: "Usage Credits · $100" },
  { value: "credits_250", label: "Usage Credits · $250" },
  { value: "credits_500", label: "Usage Credits · $500" },
];

const alternatePaths: PlanCard[] = [
  {
    code: "payg",
    name: "Pay as you go",
    price: "$0",
    period: "subscription",
    signal: "No big subscription",
    features: [
      "Managed Soft-UI routing with a hard monthly spend cap",
      "Hosted models when you want them—without a team commit",
      "Hard stop at the cap; no silent overage",
      `Best without a ${teamRange} subscription`,
    ],
  },
  {
    code: "access",
    name: "Access + PAYG",
    price: formatCatalogUsd(access.monthlyUsd),
    signal: "Light · managed routing",
    features: [
      "Unlocks Vantage-hosted Soft-UI routing",
      hostedSavings,
      "Add Credits or enable PAYG as you go",
      "Free stays your keys/local; Access is managed platform AI",
    ],
  },
];

function Cta({ label = "Join early access" }: { label?: string }) {
  return (
    <a className="button primary" href="/#waitlist">
      {label}
    </a>
  );
}

function PlanArticle({
  plan,
  footer,
}: {
  plan: PlanCard;
  footer?: ReactNode;
}) {
  return (
    <article className={plan.featured ? "featured" : undefined}>
      {plan.featured && plan.flag ? <em className="plan-flag">{plan.flag}</em> : null}
      <span className="plan-signal">{plan.signal}</span>
      <h2>{plan.name}</h2>
      <div className="plan-price">
        <strong>{plan.price}</strong>
        <small>/ {plan.period ?? "month"}</small>
      </div>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      {footer ?? <Cta />}
      {plan.note ? <p className="pricing-card-note">{plan.note}</p> : null}
    </article>
  );
}

export function PricingCatalog() {
  const [group, setGroup] = useState<"individual" | "team">("individual");
  const [teamMaxOption, setTeamMaxOption] = useState("team_max");

  const plans = useMemo(() => (group === "individual" ? individualPlans : teamPlans), [group]);

  return (
    <>
      <section className="pricing-plans" aria-label="Plan catalog">
        <div className="pricing-plans-chrome">
          <div className="pricing-toggle" role="tablist" aria-label="Pricing groups">
            <button
              id="pricing-tab-individual"
              type="button"
              role="tab"
              aria-selected={group === "individual"}
              aria-controls="pricing-plan-panel"
              className={group === "individual" ? "active" : undefined}
              onClick={() => setGroup("individual")}
            >
              Individual
            </button>
            <button
              id="pricing-tab-team"
              type="button"
              role="tab"
              aria-selected={group === "team"}
              aria-controls="pricing-plan-panel"
              className={group === "team" ? "active" : undefined}
              onClick={() => setGroup("team")}
            >
              Team
            </button>
          </div>
          <p className="pricing-savings-callout">
            <strong>Cheaper than your own keys.</strong> {hostedSavings} Managed AI plus scouting, strategy, Event Day,
            and CAD—built in, not bolted on.
          </p>
        </div>

        <div
          id="pricing-plan-panel"
          role="tabpanel"
          aria-labelledby={group === "individual" ? "pricing-tab-individual" : "pricing-tab-team"}
          aria-live="polite"
        >
          <div className={`pricing-grid ${group === "team" ? "pricing-grid-team" : ""}`}>
            {plans.map((plan) => (
              <PlanArticle
                key={plan.code}
                plan={plan}
                footer={
                  plan.code === "team_max" ? (
                    <>
                      <label className="team-max-pack">
                        <span>Subscription &amp; credit packs</span>
                        <select
                          value={teamMaxOption}
                          onChange={(e) => setTeamMaxOption(e.target.value)}
                          aria-label="Team Max subscription or higher credit packs"
                        >
                          {creditPackOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Cta
                        label={
                          teamMaxOption === "team_max"
                            ? "Join early access"
                            : "Join waitlist for credit packs"
                        }
                      />
                    </>
                  ) : undefined
                }
              />
            ))}
          </div>
        </div>
      </section>

      <section id="alternates" className="pricing-alternates">
        <span className="section-id">ALTERNATE PATHS</span>
        <h2>Skip the big team commit.</h2>
        <p>
          Prefer no {teamRange} subscription? Use pure PAYG, or Access (${access.monthlyUsd}/mo) for managed Soft-UI
          routing without a large team plan.
        </p>
        <div className="pricing-grid pricing-grid-team">
          {alternatePaths.map((plan) => (
            <PlanArticle key={plan.code} plan={plan} />
          ))}
        </div>
      </section>

      <section className="pricing-trial">
        <span className="section-id">WEEK TEAM TRIAL</span>
        <h2>Try managed team AI for {TEAM_TRIAL_DAYS} days.</h2>
        <p>
          Platform admins can grant a week team trial with hosted AI included for the trial window. No surprise
          auto-charge after the trial unless you subscribe. Existing consent rules still apply.
        </p>
      </section>
    </>
  );
}
