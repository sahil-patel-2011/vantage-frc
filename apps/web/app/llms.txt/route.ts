// GEO: plain-text summary for LLM / AI answer engines (llms.txt convention).
import { PRICING_CATALOG, TEAM_TRIAL_DAYS, hostedApiSavingsCopy } from "@vantage/billing/catalog";
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";

const c = PRICING_CATALOG;

const body = `# Vantage

> Vantage is competition operations software for FIRST Robotics Competition (FRC) teams. It runs Soft-UI hubs for Competition, Team, Business, Build, and AI in one invite-only org workspace. Surfaces stay empty until real TBA, scout, or connector data exists. AI actions are human-gated.

## Entity
- Name: Vantage (also "Vantage FRC")
- Type: Web application (installable as an iOS PWA) plus a Windows desktop shell (\`/desktop\`)
- Audience: FRC coaches, mentors, drive teams, strategy staff, and students
- Access: Closed / invite-only; platform admin provisions each team and owner; owners invite exact emails
- Contact: hello@vantagefrc.com
- Site: ${CANONICAL}/

## What Vantage does (citeable)
- Offline-first match and pit scouting with form builder, voice notes (opt-in), and sync when Wi-Fi returns.
- Competition hub: Event day, Scouting, Strategy, and Pit workbenches; My Day / Forms / Alliance desk live as inner tabs — not a 40-item More tools list.
- Team hub: Calendar, Chat, People, Work, Knowledge; Season Planning sits under Work.
- Business hub: Overview, Money, Sponsors, Grants, Outreach.
- Build hub: Kickoff, CAD, Code, Robot (FMEA/batteries/inspection as Robot tabs).
- AI hub: Ask, Library, Settings; Write and Agent are modes inside Ask; API keys under Settings.
- FRC Assistant answers cite labeled sources (official, scout, prediction); no invented DEMO win rates.
- Vantage never auto-deploys robot code.

## Pricing (Free first · credits anytime)
- Free: competition core with your own keys, local models, or buy AI credits for hosted usage.
- Every feature is on every plan, including Free; plans differ only in hosted AI allowance.
- Pro / Pro+ / Max: $${c.pro.monthlyUsd} / $${c.pro_plus.monthlyUsd} / $${c.max.monthlyUsd} per month — hosted AI allowance included; bring-your-own keys and local models work on every plan.
- Access: $${c.access.monthlyUsd}/mo light managed routing; add credits or PAYG as needed.
- ${hostedApiSavingsCopy()} Hard stop when hosted usage runs out unless AI credits or explicit PAYG with a spend cap.
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
- Desktop: ${CANONICAL}/desktop
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
