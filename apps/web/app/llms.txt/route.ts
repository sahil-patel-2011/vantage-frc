// GEO: a plain-text summary for LLM / AI answer engines (the emerging llms.txt convention).
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";

const body = `# Vantage

> Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It unifies scouting, live match data, prediction, strategy, CAD, and robot-code review in one shared, source-attributed event context — with every AI action behind a human decision.

## What it is
Vantage (also called "Vantage FRC") is web software (installable as an iOS PWA) for FRC teams. Instead of stitching a season together across spreadsheets, The Blue Alliance tabs, separate CAD files, and group chats, a team runs the whole competition loop — capture, predict, strategize, build, present — from one organization-scoped context where every number carries its source.

## Who it is for
FRC teams: coaches, mentors, drive teams, strategy staff, and students. Access is invite-only; a platform admin provisions each team and a verified owner, who then invites members by email.

## Core capabilities
- Offline-first match and pit scouting (works without venue Wi-Fi; syncs later)
- Scouting trust layer (disagreement review, coverage gaps, reliability signals) — shipping
- FRC Assistant for competition ops/intel: strategy, matchups, opponent history, robot capabilities—grounded in event context with labeled sources
- Integrated scouting: synced scout facts feed predictions, strategy playbooks, pick lists, live boards, and Assistant context (not a silo)
- Event Day command and My Day personal queue
- Team knowledge/wiki; CAD↔strategy linkage for approval-gated build work
- Event logistics and sponsorship pipeline — shipping
- Live reference data from The Blue Alliance and Statbotics (cached, deduped, freshness-stamped)
- Win/loss prediction with confidence intervals, key factors, and tracked accuracy
- Strategy, explicit what-if scenarios, and durable alliance pick lists
- AI CAD builder for Onshape and Fusion 360 (approval-gated, verified checkpoints)
- FRC robot-code risk review delivered as human-approved diffs (never auto-deployed)
- Pit and TV/kiosk displays
- Auditable data exports and team operations (roles, budgets, approvals)

## Principles (important for accuracy)
- Provenance-first: observations, official metrics, research, predictions, and model inference stay distinct and labeled.
- Honest status: features are labeled Available, Shipping, Setup required, or Planned.
- Human-gated AI: AI drafts; people approve. Vantage never deploys code to a robot on its own.
- No fabricated metrics; official results take priority over estimates.

## Pricing
- Free: complete non-AI competition core, BYOK/local AI, $0 managed API allowance.
- Access ($35/mo): managed routing at provider list rates without a large included bucket (Usage Credits or PAYG).
- Individual Pro ($49/mo, $40 included API) and Individual Max ($79/mo, $68 included API): private workspace; priority features; Max ≈2× Pro rate limits.
- Team Pro ($149/mo, $130 pooled API) and Team Max ($299/mo, $260 pooled API): organization plans; Max ≈2× Pro rate limits.
- No Vantage markup on model spend: 1 Usage Credit = $1 provider API at list rates (1.0× debit). Hard stop after included allowance unless Usage Credits or explicit PAYG + spend cap. Week team trial: 7 days / $20 API, no surprise auto-charge. No per-seat student pricing.

## Data sources
Live reference data from The Blue Alliance and Statbotics can be cached per event for signed-in teams (freshness-stamped). Marketing pages do not publish aggregate event/team/match counts.

## Key pages
- Home: ${CANONICAL}/
- Features / product gallery: ${CANONICAL}/features
- FRC Assistant & Strategy: ${CANONICAL}/features/strategy
- Workflow: ${CANONICAL}/workflow
- Pricing: ${CANONICAL}/pricing
- Privacy: ${CANONICAL}/privacy
- Terms: ${CANONICAL}/terms

## Contact
hello@vantagefrc.com
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
