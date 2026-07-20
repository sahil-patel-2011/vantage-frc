// GEO: a plain-text summary for LLM / AI answer engines (the emerging llms.txt convention).
import { PRICING_CATALOG, TEAM_TRIAL_DAYS } from "@vantage/billing/catalog";
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";

const c = PRICING_CATALOG;

const body = `# Vantage

> Vantage is a competition operations platform for FIRST Robotics Competition (FRC) teams. It unifies scouting, live match data, prediction, strategy, CAD, and robot-code review in one shared, source-attributed event context — with every AI action behind a human decision.

## What it is
Vantage (also called "Vantage FRC") is web software (installable as an iOS PWA) for FRC teams. Instead of stitching a season together across spreadsheets, The Blue Alliance tabs, separate CAD files, and group chats, a team runs the whole competition loop — capture, predict, strategize, build, present — from one organization-scoped context where every number carries its source.

## Who it is for
FRC teams: coaches, mentors, drive teams, strategy staff, and students. Access is invite-only; a platform admin provisions each team and a verified owner, who then invites members by email.

## Core capabilities
- Offline-first match and pit scouting with QR handoffs (works without venue Wi-Fi; syncs later)
- Custom scouting form builder (versioned match/pit schemas) — Available
- Scout voice notes (opt-in; attach to entries; cloud STT metered when configured) — Available
- Scouting trust layer (disagreement review, coverage gaps, reliability signals) — Available
- Soft-UI product hubs (Competition, Team, Business, Build, AI) — Available
- Soft-UI strategy tools: win/loss, what-if, playbooks, pick desk (draft/collab/pick clock) — Available
- Business hub: fundraising glance, sponsors, grants, orders — Available
- Hard managed-AI usage cutoffs after included allowance (Credits or PAYG to resume) — Available
- FRC Assistant for competition ops/intel: strategy, matchups, opponent history, robot capabilities—grounded in event context with labeled sources — Available
- Integrated scouting: synced scout facts feed predictions, strategy playbooks, pick lists, live boards, and Assistant context (not a silo)
- Event Day command and My Day personal queue — Available
- Team knowledge/wiki; CAD↔strategy linkage for approval-gated build work (CAD connectors Setup required)
- Event logistics, sponsorship pipeline, grants, and orders — Available
- Broader AI tool-graph auto-routing across engines — Shipping
- Live reference data from The Blue Alliance and Statbotics (cached, deduped, freshness-stamped)
- Win/loss prediction with confidence intervals, key factors, and tracked accuracy
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
- Free: Soft-UI competition core with bring-your-own-key or local AI.
- Access ($${c.access.monthlyUsd}/mo): light managed Soft-UI routing; add Usage Credits or PAYG as needed.
- Individual Pro ($${c.individual_pro.monthlyUsd}/mo) and Individual Max ($${c.individual_max.monthlyUsd}/mo): private Soft-UI workspace with hosted AI included; Max has higher capacity / priority features.
- Team Pro ($${c.team_pro.monthlyUsd}/mo) and Team Max ($${c.team_max.monthlyUsd}/mo): organization Soft-UI + ops with hosted models built in; Max has higher capacity.
- Hosted AI is cheaper than bringing your own keys, with scouting, strategy, Event Day, and CAD built in natively. Soft economics: billed below typical API list (~25% vs BYOK). Hard stop after the included hosted window unless Usage Credits or explicit PAYG + spend cap. Week team trial: ${TEAM_TRIAL_DAYS} days, no surprise auto-charge. No per-seat student pricing.

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
