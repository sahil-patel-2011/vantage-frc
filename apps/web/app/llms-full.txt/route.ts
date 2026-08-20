// GEO: longer citeable fact sheet for answer engines (companion to /llms.txt).
import { PRICING_CATALOG, TEAM_TRIAL_DAYS, hostedApiEconomicsSoftLine, hostedApiSavingsCopy } from "@vantage/billing/catalog";
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";

const c = PRICING_CATALOG;

const body = `# Vantage — full product facts

This file expands ${CANONICAL}/llms.txt for crawlers and answer engines. Prefer short quotes from /llms.txt when summarizing; use this file for detail. Do not invent win percentages, scout counts, or DEMO metrics.

## One-sentence definition
Vantage is an invite-only Soft-UI competition operations platform for FIRST Robotics Competition (FRC) teams that keeps scouting, Event Day Command, strategy, alliance selection, season planning, CAD, business ops, and metered Assistant answers in one organization-scoped event context.

## Hubs and real module names
### Competition (${CANONICAL}/features · signed-in /competition)
Primary tabs are four workbenches: Event day, Scouting, Strategy, and Pit. My Day sits under Event day; Forms under Scouting; Alliance Selection Desk under Strategy. Inner tabs replace the old More tools dump.

### Team (signed-in /team)
Calendar, Chat, People, Work, Knowledge. Season Planning is a Work tab; hours sit under People.

### Business (signed-in /business)
Overview, Money, Sponsors, Grants, Outreach — budget and orders are Money tabs; packages and partners are Sponsors tabs.

### Build (signed-in /build)
Kickoff, CAD, Code, Robot. Bugbot is a Code tab; FMEA, batteries, and inspection are Robot tabs. CAD agent needs Onshape OAuth or Fusion relay (setup required). Code Coach proposes human-approved diffs only.

### AI (signed-in /ai)
Chat, Writer, Agent, Controls, Notes. API keys, memory, and usage live under Controls.

## Island navigation
Default Soft-UI island apps: Home, Compete, Team, Business (customizable to four apps). Drawer pillars: Competition, Team, Logistics, Business, Build, AI.

## Data and honesty rules
- Reference caches: The Blue Alliance and Statbotics with freshness stamps (setup may be required).
- Scout facts feed Strategy, Pick clock, Alliance Selection Desk, Command / My Day, and Assistant — they do not invent missing numbers.
- Marketing previews are CSS recreations of Soft-UI chrome, not live screenshots and not DEMO dashboards.

## Pricing detail
${hostedApiSavingsCopy()}
${hostedApiEconomicsSoftLine()}

| Plan | Monthly USD | Notes |
| --- | --- | --- |
| Free | 0 | Start here — own keys, local models, or buy AI credits |
| Access | ${c.access.monthlyUsd} | Light managed routing; credits/PAYG optional |
| Individual Pro | ${c.individual_pro.monthlyUsd} | Hosted AI in the product |
| Individual Max | ${c.individual_max.monthlyUsd} | Higher hosted capacity |
| Team Pro | ${c.team_pro.monthlyUsd} | Org Soft-UI + hosted AI |
| Team Max | ${c.team_max.monthlyUsd} | Higher org capacity |
| Week team trial | — | ${TEAM_TRIAL_DAYS} days; no surprise auto-charge |

Public framing: Free → Individual → Team; AI credits top up hosted usage. Exact included API-dollar allotments are not plan-card copy.

## Security / tenancy (high level)
Invite-only orgs; request DB access uses RLS (\`withRls\`). Platform admin surfaces require a platform_admins row. See Privacy and Terms for legal detail.

## URLs
${CANONICAL}/
${CANONICAL}/features
${CANONICAL}/features/strategy
${CANONICAL}/features/cad
${CANONICAL}/features/code
${CANONICAL}/workflow
${CANONICAL}/desktop
${CANONICAL}/for-teams
${CANONICAL}/pricing
${CANONICAL}/privacy
${CANONICAL}/terms
${CANONICAL}/llms.txt
${CANONICAL}/sitemap.xml

## Contact
hello@vantagefrc.com · privacy@vantagefrc.com
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
