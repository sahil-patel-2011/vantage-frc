// GEO: plain-text summary for LLM / AI answer engines (llms.txt convention).
import { PRICING_CATALOG, TEAM_TRIAL_DAYS, hostedApiSavingsCopy } from "@vantage/billing/catalog";
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";

const c = PRICING_CATALOG;

const body = `# Vantage

> Vantage is competition operations software for FIRST Robotics Competition (FRC) teams. It runs Soft-UI hubs for Competition, Team, Business, Build, and AI in one invite-only org workspace. Surfaces stay empty until real TBA, scout, or connector data exists. AI actions are human-gated.

## Entity
- Name: Vantage (also "Vantage FRC")
- Type: Web application (installable as an iOS PWA)
- Audience: FRC coaches, mentors, drive teams, strategy staff, and students
- Access: Closed / invite-only; platform admin provisions each team and owner; owners invite exact emails
- Contact: hello@vantagefrc.com
- Site: ${CANONICAL}/

## What Vantage does (citeable)
- Offline-first match and pit scouting with form builder, voice notes (opt-in), and sync when Wi-Fi returns.
- Competition hub: Command, My Day, Strategy, Scouting, Form builder, Match checklist, Pick clock; Alliance Selection Desk in More tools.
- Team hub: Calendar, todos, practice, attendance, knowledge; Season Planning Workspace in More tools.
- Business hub: Budget, orders, sponsors, grants, partners, award evidence.
- Build hub: Kickoff, CAD agent (Onshape/Fusion, setup required), Code Coach, FMEA, prototypes.
- AI hub: Assistant chat, budgets, writer, code assist; AI API keys at /team/ai-keys (BYOK on Free).
- FRC Assistant answers cite labeled sources (official, scout, prediction); no invented DEMO win rates.
- Vantage never auto-deploys robot code.

## Pricing (hosted AI as a service — not an API wallet)
- Free: competition core with bring-your-own-key or local OpenAI-compatible models.
- Access: $${c.access.monthlyUsd}/mo for light managed routing; add Credits or PAYG as needed.
- Individual Pro / Max: $${c.individual_pro.monthlyUsd} / $${c.individual_max.monthlyUsd} per month.
- Team Pro / Max: $${c.team_pro.monthlyUsd} / $${c.team_max.monthlyUsd} per month.
- ${hostedApiSavingsCopy()} Hard stop after the included hosted window unless Usage Credits or explicit PAYG with a spend cap.
- Week team trial: ${TEAM_TRIAL_DAYS} days. No per-seat student pricing.

## Principles
- Provenance-first: official, scout, prediction, and approval stay labeled.
- Honest empty states: no fabricated metrics on marketing or product.
- Human-gated AI: drafts require approval; never robot auto-deploy.

## Key URLs
- Home: ${CANONICAL}/
- Product map: ${CANONICAL}/features
- Strategy & Assistant: ${CANONICAL}/features/strategy
- CAD agent: ${CANONICAL}/features/cad
- Code Coach: ${CANONICAL}/features/code
- How it works: ${CANONICAL}/workflow
- For teams: ${CANONICAL}/for-teams
- Pricing: ${CANONICAL}/pricing
- Privacy: ${CANONICAL}/privacy
- Terms: ${CANONICAL}/terms
- Full facts: ${CANONICAL}/llms-full.txt
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
