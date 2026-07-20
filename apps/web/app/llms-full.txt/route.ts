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
Primary tabs include Command, My Day, Strategy, Scouting, Form builder, Match checklist, Pick clock, and Chemistry. Featured More tools include Alliance Selection Desk. Offline scouting works when venue Wi-Fi drops; sync resumes with attribution.

### Team (signed-in /team)
Calendar, Todos, Messages, Practice, Knowledge, Attendance, Batteries, FMEA. Featured More tool: Season Planning Workspace (goals, milestones, owners from real logs).

### Business (signed-in /business)
Overview, Budget, Orders, Sponsors, Sponsorship, Grants, Partners, Awards — plus related fundraising and impact tools in More.

### Build (signed-in /build)
Kickoff, CAD, Code, FMEA, Prototypes, Batteries. CAD agent needs Onshape OAuth or Fusion relay (setup required). Code Coach proposes human-approved diffs only.

### AI (signed-in /ai)
Chat, Budgets, Writer, Code assist, Memory, Governance. Featured More tool: AI API keys at /team/ai-keys for Free / BYOK teams. Paid plans add Vantage-hosted model routing.

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
| Free | 0 | BYOK / local models; competition core |
| Access | ${c.access.monthlyUsd} | Light managed routing; Credits/PAYG optional |
| Individual Pro | ${c.individual_pro.monthlyUsd} | Hosted AI included |
| Individual Max | ${c.individual_max.monthlyUsd} | Higher hosted capacity |
| Team Pro | ${c.team_pro.monthlyUsd} | Org Soft-UI + hosted AI |
| Team Max | ${c.team_max.monthlyUsd} | Higher org capacity |
| Week team trial | — | ${TEAM_TRIAL_DAYS} days; no surprise auto-charge |

Exact included API-dollar allotments are not the public framing — plans sell hosted AI as a product service with hard cutoffs.

## Security / tenancy (high level)
Invite-only orgs; request DB access uses RLS (\`withRls\`). Platform admin surfaces require a platform_admins row. See Privacy and Terms for legal detail.

## URLs
${CANONICAL}/
${CANONICAL}/features
${CANONICAL}/features/strategy
${CANONICAL}/features/cad
${CANONICAL}/features/code
${CANONICAL}/workflow
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
