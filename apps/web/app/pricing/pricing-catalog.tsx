"use client";

import { useMemo, useState, type ReactNode } from "react";

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

const individualPlans: PlanCard[] = [
  {
    code: "free",
    name: "Free",
    price: "$0",
    signal: "BYOK / LOCAL · $0 MANAGED",
    features: [
      "Complete non-AI competition core: scouting, TBA/Statbotics, manual strategy, exports, team ops",
      "Bring a supported API key or pair a local OpenAI-compatible relay",
      "Managed routing is stronger because of integrated tools, context, and failover—not because BYOK is sabotaged",
      "No included managed API allowance; no silent paid-model routing",
    ],
  },
  {
    code: "individual_pro",
    name: "Individual Pro",
    price: "$30",
    signal: "PRIVATE · $27 API INCLUDED",
    featured: true,
    flag: "Popular starting point",
    features: [
      "$27 included managed API allowance per month, then hard cut-off",
      "Debited at published provider list rates (1 Usage Credit = $1 API cost)",
      "Private workspace only; priority access to new features",
      "After allowance: buy Usage Credits or enable PAYG with a spend cap",
    ],
  },
  {
    code: "individual_max",
    name: "Individual Max",
    price: "$50",
    signal: "PRIVATE · $45 API · ~2× PRO LIMITS",
    features: [
      "$45 included managed API allowance per month, then hard cut-off",
      "~2× Individual Pro hourly, rate, and concurrency limits",
      "Private workspace only; priority access to new features",
      "After allowance: Usage Credits or explicit PAYG + spend cap",
    ],
  },
];

const teamPlans: PlanCard[] = [
  {
    code: "team_pro",
    name: "Team Pro",
    price: "$100",
    signal: "ORG · $90 API POOLED",
    featured: true,
    flag: "Most teams start here",
    features: [
      "$90 pooled managed API allowance per month, then hard cut-off",
      "Shared AI, automations, and org budget/member/feature controls",
      "Priority access to new features",
      "After allowance: pooled Usage Credits or PAYG with a hard monthly cap",
    ],
  },
  {
    code: "team_max",
    name: "Team Max",
    price: "$200",
    signal: "ORG · $185 API · ~2× PRO LIMITS",
    features: [
      "$185 pooled managed API allowance per month, then hard cut-off",
      "~2× Team Pro rate, hourly, and concurrency limits",
      "Advanced CAD, strategy, code review, and admin workflows",
      "Explore higher credit packs below when you need more pooled API",
    ],
  },
];

const creditPackOptions = [
  { value: "team_max", label: "$200/mo subscription ($185 included API)" },
  { value: "credits_100", label: "Add Usage Credits pack · $100 (= $100 API)" },
  { value: "credits_250", label: "Add Usage Credits pack · $250 (= $250 API)" },
  { value: "credits_500", label: "Add Usage Credits pack · $500 (= $500 API)" },
];

const alternatePaths: PlanCard[] = [
  {
    code: "payg",
    name: "Pay as you go",
    price: "$0",
    period: "subscription",
    signal: "NO BIG SUBSCRIPTION",
    features: [
      "No included API bucket — enroll PAYG with a payment method and hard monthly spend cap",
      "Usage debited at provider list rates (1 credit = $1 API)",
      "Hard stop when prepaid credits and/or the spend cap are exhausted",
      "Best when you want managed routing without a $100–$200 commit",
    ],
  },
  {
    code: "access",
    name: "Access + PAYG",
    price: "$20",
    signal: "LIGHT PLAN · MANAGED ROUTING",
    features: [
      "$20/mo unlocks Vantage managed routing, tools, and context at API list rates",
      "No large included allowance — add Usage Credits or enable PAYG with a spend cap",
      "Clearer vs Free: Free is BYOK/local; Access is managed platform routing without a big included bucket",
      "Optional path for individuals and small teams avoiding Team Pro/Max commit",
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
      <span>{plan.signal}</span>
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
      <section className="pricing-toggle" aria-label="Pricing groups" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={group === "individual"}
          className={group === "individual" ? "active" : undefined}
          onClick={() => setGroup("individual")}
        >
          Individual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={group === "team"}
          className={group === "team" ? "active" : undefined}
          onClick={() => setGroup("team")}
        >
          Team
        </button>
      </section>

      <section id={group} aria-live="polite">
        <span className="section-id">
          {group === "individual" ? "INDIVIDUAL / PRIVATE WORKSPACE" : "TEAM / ENTIRE ORGANIZATION"}
        </span>
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
      </section>

      <section id="alternates" className="pricing-alternates">
        <span className="section-id">ALTERNATE PATHS</span>
        <h2>Skip the big team commit.</h2>
        <p>
          Prefer no $100–$200 subscription? Use pure PAYG, or Access ($20/mo) plus Usage Credits / PAYG for managed
          routing without a large included allowance.
        </p>
        <div className="pricing-grid pricing-grid-team">
          {alternatePaths.map((plan) => (
            <PlanArticle key={plan.code} plan={plan} />
          ))}
        </div>
      </section>

      <section className="pricing-trial">
        <span className="section-id">WEEK TEAM TRIAL</span>
        <h2>Try managed team AI for 7 days.</h2>
        <p>
          Platform admins can grant a week team trial with <strong>$20</strong> included managed API allowance. No
          surprise auto-charge after the trial unless you subscribe. Existing consent rules still apply.
        </p>
      </section>
    </>
  );
}
