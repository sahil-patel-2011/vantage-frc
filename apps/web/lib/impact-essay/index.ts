// Pure helper functions for the FIRST Impact essay generator — no I/O, unit-testable.
// composeEssay derives the entire narrative + citation list from the grounded facts passed
// in; when a record type is absent it is simply omitted from the essay, never invented.

import type {
  ImpactEssayAward,
  ImpactEssayCitation,
  ImpactEssayGroundedFacts,
} from "./types";

export const IMPACT_ESSAY_AWARDS: ImpactEssayAward[] = ["impact", "engineering_inspiration"];

export const AWARD_LABEL: Record<ImpactEssayAward, string> = {
  impact: "FIRST Impact Award",
  engineering_inspiration: "Engineering Inspiration Award",
};

export function awardLabel(award: ImpactEssayAward): string {
  return AWARD_LABEL[award];
}

export function awardPrompt(award: ImpactEssayAward): string {
  return award === "impact"
    ? "How has your team's outreach, sustainability, and community partnerships spread the FIRST message and made a measurable difference this season?"
    : "How has your team inspired students to pursue engineering and technology, and grown the next generation of STEM participants this season?";
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function citationLabelForActivity(activity: ImpactEssayGroundedFacts["outreachActivities"][number]): string {
  return `${activity.title} (${activity.occurredOn})`;
}

function citationLabelForEvent(event: ImpactEssayGroundedFacts["events"][number]): string {
  return `${event.title} (${event.occurredOn})`;
}

function citationLabelForSponsor(sponsor: ImpactEssayGroundedFacts["sponsors"][number]): string {
  return `${sponsor.name} (${sponsor.tier} sponsor)`;
}

/**
 * Deterministic essay synthesis: every sentence is templated from counted, real rows and
 * carries a bracketed citation marker `[n]` pointing at the returned citations list.
 */
export function composeEssay(
  award: ImpactEssayAward,
  facts: ImpactEssayGroundedFacts,
): { text: string; citations: ImpactEssayCitation[] } {
  const citations: ImpactEssayCitation[] = [];
  const mark = (kind: ImpactEssayCitation["kind"], id: string, label: string): string => {
    citations.push({ id, kind, label });
    return `[${citations.length}]`;
  };

  const paragraphs: string[] = [];

  if (!facts.hasGroundedData) {
    return {
      text:
        "No logged outreach activities, build hours, sponsors, or team events were found for this season yet. " +
        "Log records in Community Impact, Hours, Sponsors, and Team Events before drafting this essay so every " +
        "claim can be grounded in a real record.",
      citations: [],
    };
  }

  const topActivities = facts.outreachActivities.slice(0, 6);
  if (topActivities.length > 0) {
    const markers = topActivities.map((activity) =>
      mark("outreach_activity", activity.id, citationLabelForActivity(activity)),
    );
    const sentence =
      `In the ${facts.seasonYear} season, our team logged ${facts.outreachActivities.length} outreach ` +
      `activit${facts.outreachActivities.length === 1 ? "y" : "ies"} reaching ${facts.totalPeopleReached.toLocaleString()} ` +
      `people over ${facts.totalOutreachHours} hour(s), including ${topActivities
        .map((activity, i) => `${activity.title}${markers[i]}`)
        .join(", ")}.`;
    paragraphs.push(sentence);
  }

  if (facts.buildHours.totalHours > 0) {
    paragraphs.push(
      `${facts.buildHours.contributorCount} team member(s) logged ${facts.buildHours.totalHours} hour(s) ` +
        `of build and outreach shop time this season, evidence of a sustained, hands-on program.`,
    );
  }

  if (facts.sponsors.length > 0) {
    const topSponsors = facts.sponsors.slice(0, 5);
    const markers = topSponsors.map((sponsor) => mark("sponsor", sponsor.id, citationLabelForSponsor(sponsor)));
    paragraphs.push(
      `Our program is sustained by ${facts.sponsors.length} active sponsor relationship(s), including ` +
        `${topSponsors.map((sponsor, i) => `${sponsor.name}${markers[i]}`).join(", ")}, reflecting community investment ` +
        `in our mission.`,
    );
  }

  if (facts.events.length > 0) {
    const topEvents = facts.events.slice(0, 5);
    const markers = topEvents.map((event) => mark("team_event", event.id, citationLabelForEvent(event)));
    paragraphs.push(
      `The team held ${facts.events.length} logged event(s) this season, including ` +
        `${topEvents.map((event, i) => `${event.title}${markers[i]}`).join(", ")}, building consistent team ` +
        `engagement and community presence.`,
    );
  }

  if (paragraphs.length === 0) {
    return {
      text:
        "No logged outreach activities, build hours, sponsors, or team events were found for this season yet. " +
        "Log records before drafting this essay so every claim can be grounded in a real record.",
      citations: [],
    };
  }

  return { text: paragraphs.join("\n\n"), citations };
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
