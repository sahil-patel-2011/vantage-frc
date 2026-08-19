// Pure markdown for graduation exit interviews → knowledge_pages (CD #27).
// Never invents DEMO metrics; blank answers stay blank placeholders.

import { knowledgeHitHref, slugifyTitle } from "../knowledge/helpers";
import type { ExitInterviewRecord } from "./types";

function section(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "-";
}

export function exitInterviewWikiTitle(input: {
  memberName: string;
  graduationYear: number;
}): string {
  const name = input.memberName.trim() || "member";
  return `Exit interview — ${name} (class of ${input.graduationYear})`.slice(0, 200);
}

export function exitInterviewWikiSlug(input: {
  memberName: string;
  seasonYear: number;
  suffix?: string;
}): string {
  const name = slugifyTitle(input.memberName);
  const extra = input.suffix ? `-${slugifyTitle(input.suffix)}` : "";
  return slugifyTitle(`exit-${input.seasonYear}-${name}${extra}`);
}

type WikiSource = Pick<
  ExitInterviewRecord,
  | "memberName"
  | "role"
  | "yearsOnTeam"
  | "graduationYear"
  | "seasonYear"
  | "highlights"
  | "adviceForFuture"
  | "skillsToDocument"
  | "willingToMentor"
  | "contactEmail"
>;

export function buildExitInterviewWikiBody(record: WikiSource): string {
  return `# Season handoff

**Season year:** ${record.seasonYear}
**Authors:** ${record.memberName.trim()}
**Role:** ${record.role}
**Years on team:** ${record.yearsOnTeam}
**Graduation year:** ${record.graduationYear}

## What we shipped
${section(record.highlights)}

## What burned time
-

## Design choices to keep
${section(record.adviceForFuture)}

## Design choices to revisit
-

## Skills to document
${section(record.skillsToDocument)}

## Open loops for kickoff week
1.
2.
3.

## People / accounts / vault pointers (no secrets)
- Willing to mentor: ${record.willingToMentor ? "yes" : "no"}
- Contact: ${section(record.contactEmail)}
`.slice(0, 50000);
}

export function exitInterviewWikiHref(orgId: string, pageId: string): string {
  return knowledgeHitHref("wiki", pageId, orgId);
}
