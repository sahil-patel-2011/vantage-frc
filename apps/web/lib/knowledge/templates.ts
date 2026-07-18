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
): { title: string; body: string; tags: string[]; templateKind: KnowledgeTemplateKind } {
  const tpl = templateByKind(kind);
  if (!tpl) {
    return {
      title: "New page",
      body: teamNumber ? `# Team ${teamNumber}\n\n` : "# \n\n",
      tags: [],
      templateKind: kind === "other" ? "other" : "blank",
    };
  }
  const team = teamNumber ? `Team ${teamNumber}` : "Our team";
  const body = tpl.body.replace(/^# /m, `# ${team} — `);
  return { title: tpl.title, body, tags: [...tpl.defaultTags], templateKind: kind };
}
