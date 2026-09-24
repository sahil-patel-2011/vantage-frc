// GEO: longer citeable fact sheet for answer engines (companion to /llms.txt).
import { SITE_URL as CANONICAL } from "../../lib/site";

export const dynamic = "force-static";


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
Default island apps: Home, Matches, Scout, and Stats (customizable to four apps). Drawer pillars: Competition, Team, Logistics, Business, Build. Ask AI is a control, not a pillar.

## Data and honesty rules
- Reference caches: The Blue Alliance and Statbotics with freshness stamps (setup may be required).
- Scout facts feed Strategy, Pick clock, Alliance Selection Desk, Command / My Day, and Assistant — they do not invent missing numbers.
- Marketing previews are CSS recreations of Soft-UI chrome, not live screenshots and not DEMO dashboards.

## Cost
- Free for every team, with every feature included. No plans, no card.
- AI runs on the team's own key (OpenAI, Anthropic, Google AI Studio, OpenRouter, or any OpenAI-compatible endpoint), a free-tier key, or a local model via Ollama / LM Studio. The provider bills the team directly.
- Without any key, everything except the AI assistants works.

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
vantagefrc@gmail.com
`;

export function GET() {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
