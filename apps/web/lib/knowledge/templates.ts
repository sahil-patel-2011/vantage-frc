// Structured handoff templates for knowledge_pages.template_kind (CD #26).

import type { KnowledgeTemplateKind } from "./types";

export type KnowledgeTemplate = {
  kind: KnowledgeTemplateKind;
  title: string;
  blurb: string;
  body: string;
  defaultTags: string[];
};

export const KNOWLEDGE_TEMPLATES: KnowledgeTemplate[] = [
  {
    kind: "season_playbook",
    title: "Season playbook",
    blurb: "Before the season, meetings, build, competition ops, and after — fill in this team’s real facts.",
    defaultTags: ["playbook", "season", "ops"],
    body: `# {{team}} {{year}} season playbook

**Season year:** {{year}}
**Team:** {{team}}
**Owners:**

## Before the season
- Shop / storage access, insurance, and student paperwork
- Kickoff watch plan and first-meeting agenda
- Budget envelope and sponsor asks already in motion
- Tooling, printer, and inventory that actually exists

## Meetings
- Weekly cadence (day, time, who must be in the room)
- Agenda for the next meeting (decisions, not status theater)
- Who captures notes in Team chat after each meeting

## Build
- Mechanism owners and “done” definition for each
- Integration checkpoints before stop-build
- Spare parts that have already failed once

## Competition ops
- Pit roles, queue time, bumper color, and pack-out
- Drive-team brief: auto, defense, and partner asks
- Inspection / re-weigh / battery cart

## After the season
- What to keep vs scrap
- Handoff owners for CAD, code, and inventory
- Post-mortem: what burned time, what we would repeat
`,
  },
  {
    kind: "season_handoff",
    title: "Season handoff",
    blurb: "End-of-season dump so next year’s team inherits what actually mattered.",
    defaultTags: ["handoff", "season"],
    body: `# Season handoff

**Season year:**
**Authors:**

## What we shipped
-

## What burned time
-

## Design choices to keep
-

## Design choices to revisit
-

## Open loops for kickoff week
1.
2.
3.

## People / accounts / vault pointers (no secrets)
-
`,
  },
  {
    kind: "subsystem",
    title: "Subsystem knowledge dump",
    blurb: "Mechanical / electrical / intake / climber — what only that subteam knows.",
    defaultTags: ["handoff", "subsystem"],
    body: `# Subsystem knowledge dump

**Subsystem:**
**Owners:**
**Season:**

## Current design (as-built)
-

## Known failure modes
-

## Tuning / setup checklist
-

## Parts & vendors shortcuts
-

## If it breaks at an event
-

## Onboarding a new member on this subsystem
1.
2.
3.
`,
  },
  {
    kind: "inventory_handoff",
    title: "Inventory expert brain dump",
    blurb: "Capture where parts really live, naming conventions, substitutes, vendors, and event-pack shortcuts.",
    defaultTags: ["handoff", "inventory", "parts"],
    body: `# Inventory expert brain dump

**Primary inventory expert:**
**Backup owner:**
**Season:**

## How the shop is organized
- Location and bin naming rules:
- Places people forget to check:
- Parts stored outside the main shop:

## Critical spares and substitutes
| Part | Normal location | Acceptable substitute | Minimum event quantity |
|---|---|---|---:|
| | | | |

## Vendor and ordering shortcuts
- Preferred vendors / account owner (no passwords):
- Long-lead items:
- Parts we should never run out of:

## Pit and travel packing knowledge
- What always goes to events:
- What stays home:
- Last-minute checks:

## Scan-label cleanup
- [ ] Every active bin has a Vantage QR label
- [ ] Unassigned inventory items were given a location
- [ ] Obsolete locations were archived or renamed

## If I am unavailable
1.
2.
3.
`,
  },
  {
    kind: "role_onboarding",
    title: "Role onboarding path",
    blurb: "Guided first steps for a new lead, mentor, or scout — not a 9-page wall of text.",
    defaultTags: ["onboarding", "role"],
    body: `# Role onboarding

**Role:**
**Audience:** (student / mentor / volunteer)

## Week 1 — orient
- [ ] Meet lead mentor & student lead
- [ ] Safety / shop rules
- [ ] Accounts you need

## Week 2 — contribute
- [ ] Shadow one session
- [ ] Complete a first small task
- [ ] Read linked wiki pages

## Who to ask for what
-

## Do not start here (common confusion)
-
`,
  },
  {
    kind: "pit_ops",
    title: "Pit operations playbook",
    blurb: "Roles, pack lists, and match turnaround habits.",
    defaultTags: ["procedure", "pit"],
    body: `# Pit operations playbook

## Roles on event day
- Pit lead:
- Mechanical:
- Electrical:
- Soft / DS:

## Pack / unpack checklist
-

## Match turnaround
-

## Battery & spare parts rules
-

## When to escalate
-
`,
  },
  {
    kind: "software",
    title: "Software / controls stack",
    blurb: "Repos, deploy, DS map, and how code actually ships.",
    defaultTags: ["software", "reference"],
    body: `# Software / controls stack

## Repos & branches
-

## Deploy procedure
-

## Driver Station / controller map
-

## Known gotchas
-

## Onboarding a new programmer
1.
2.
3.
`,
  },
  {
    kind: "cad_conventions",
    title: "CAD conventions",
    blurb: "Naming, folders, mates, and review gates so CAD knowledge survives graduation.",
    defaultTags: ["cad", "reference"],
    body: `# CAD conventions

## Tools & document layout
-

## Naming / revision rules
-

## How we review designs
-

## Export / fab handoff
-

## Common mistakes
-
`,
  },
];

export function templateByKind(kind: string | null | undefined): KnowledgeTemplate | null {
  if (!kind || kind === "blank" || kind === "other") return null;
  return KNOWLEDGE_TEMPLATES.find((t) => t.kind === kind) ?? null;
}

export function applyKnowledgeTemplate(
  kind: KnowledgeTemplateKind,
  teamNumber: number | null,
  extras?: { orgName?: string | null; seasonYear?: number | null },
): { title: string; body: string; tags: string[]; templateKind: KnowledgeTemplateKind } {
  const tpl = templateByKind(kind);
  const team = teamNumber
    ? `Team ${teamNumber}`
    : extras?.orgName?.trim() || "Our team";
  const year = extras?.seasonYear ?? new Date().getFullYear();
  if (!tpl) {
    return {
      title: "New page",
      body: `# ${team}\n\n`,
      tags: [],
      templateKind: kind === "other" ? "other" : "blank",
    };
  }
  const titled = /season/i.test(tpl.title) ? `${team} ${tpl.title.toLowerCase()}` : tpl.title;
  const personalized = tpl.body
    .replaceAll("{{team}}", team)
    .replaceAll("{{year}}", String(year));
  const alreadyNamed = tpl.body.includes("{{team}}") || personalized.startsWith(`# ${team}`);
  const body = alreadyNamed ? personalized : personalized.replace(/^# /m, `# ${team} — `);
  return { title: titled, body, tags: [...tpl.defaultTags], templateKind: kind };
}
