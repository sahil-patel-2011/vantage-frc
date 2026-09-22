/**
 * What the next game might ask for, from signals a team actually recorded.
 *
 * Teams already do this. Somebody notices what FTC's game asks robots to do,
 * somebody else screenshots a teaser, and it lives in a group chat until
 * kickoff, by which point nobody can find it. This is that chat with a shape:
 * every entry carries who saw it, where, and when.
 *
 * What this deliberately does not do is predict the game. It has no dataset of
 * past games to reason from and no way to acquire one honestly, so a sentence
 * like "next year will be a shooting game" would be invention dressed as
 * analysis — exactly the thing a team would then build a robot around. What it
 * does instead is aggregate the reads a team's own members recorded, and say
 * plainly how thin the evidence under each one is.
 *
 * The confidence rules are deliberately hard to satisfy. A wrong "well
 * supported" in October costs a team its offseason.
 */

export type SignalKind =
  /** FIRST's own announcement, or the published game for the overlapping FTC season. */
  | "announcement"
  | "ftc-game"
  /** A teaser image, video or date drop from FIRST. */
  | "teaser"
  /** Something someone heard. Recorded so it stops being repeated as fact. */
  | "rumour";

export type Capability =
  | "scoring-height"
  | "ground-pickup"
  | "climb"
  | "traversal"
  | "human-player"
  | "autonomous"
  | "defense";

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "scoring-height": "Scoring high",
  "ground-pickup": "Picking up off the floor",
  climb: "Climbing or hanging",
  traversal: "Crossing the field",
  "human-player": "Working with a human player",
  autonomous: "A demanding autonomous",
  defense: "Playing or taking defence",
};

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  announcement: "FIRST announcement",
  "ftc-game": "This year's FTC game",
  teaser: "Teaser",
  rumour: "Heard secondhand",
};

export type NextSeasonSignal = {
  id: string;
  kind: SignalKind;
  /** ISO date the signal was observed, not the date it was entered. */
  observedOn: string;
  /** Where it came from — a link, a video, a person. Identity matters for counting. */
  source: string;
  note: string;
  /** What the person who recorded it thinks it points at. */
  pointsAt: Capability[];
};

export type Confidence = "thin" | "worth-planning-for" | "well-supported";

export type CapabilityRead = {
  capability: Capability;
  label: string;
  signals: number;
  /** Distinct sources, ignoring rumours: two people repeating one rumour is one rumour. */
  independentSources: number;
  kinds: SignalKind[];
  confidence: Confidence;
  /** Why it landed at that confidence, in words, so nobody has to guess. */
  because: string;
};

/** A rumour is worth recording and worth nothing on its own. */
function corroborating(signals: NextSeasonSignal[]): NextSeasonSignal[] {
  return signals.filter((signal) => signal.kind !== "rumour");
}

function distinctSources(signals: NextSeasonSignal[]): number {
  return new Set(signals.map((signal) => signal.source.trim().toLowerCase()).filter(Boolean)).size;
}

function confidenceFor(signals: NextSeasonSignal[]): { confidence: Confidence; because: string } {
  const solid = corroborating(signals);
  const sources = distinctSources(solid);
  const hasAnnouncement = solid.some((signal) => signal.kind === "announcement");
  const hasFtc = solid.some((signal) => signal.kind === "ftc-game");

  if (sources >= 2 && (hasAnnouncement || hasFtc)) {
    return {
      confidence: "well-supported",
      because: `${sources} separate sources, including ${hasAnnouncement ? "an announcement from FIRST" : "this year's FTC game"}.`,
    };
  }
  if (hasAnnouncement) {
    return {
      confidence: "worth-planning-for",
      because: "An announcement from FIRST, but only one source so far.",
    };
  }
  if (sources >= 2) {
    return {
      confidence: "worth-planning-for",
      because: `${sources} separate sources, none of them an announcement.`,
    };
  }
  if (!solid.length) {
    return {
      confidence: "thin",
      because: "Only things heard secondhand. Worth writing down, not worth building around.",
    };
  }
  return {
    confidence: "thin",
    because: "One source. Find a second before this changes anything.",
  };
}

/**
 * What the recorded signals collectively point at, strongest first.
 *
 * Capabilities nobody has pointed at are absent rather than listed at zero: an
 * empty row reads as evidence of absence, and silence here means nobody looked.
 */
export function capabilityReads(signals: NextSeasonSignal[]): CapabilityRead[] {
  const byCapability = new Map<Capability, NextSeasonSignal[]>();
  for (const signal of signals) {
    for (const capability of signal.pointsAt) {
      const list = byCapability.get(capability) ?? [];
      list.push(signal);
      byCapability.set(capability, list);
    }
  }

  const reads: CapabilityRead[] = [];
  for (const [capability, list] of byCapability) {
    const { confidence, because } = confidenceFor(list);
    reads.push({
      capability,
      label: CAPABILITY_LABEL[capability],
      signals: list.length,
      independentSources: distinctSources(corroborating(list)),
      kinds: [...new Set(list.map((signal) => signal.kind))],
      confidence,
      because,
    });
  }

  const rank: Record<Confidence, number> = {
    "well-supported": 0,
    "worth-planning-for": 1,
    thin: 2,
  };
  return reads.sort(
    (a, b) =>
      rank[a.confidence] - rank[b.confidence] ||
      b.independentSources - a.independentSources ||
      b.signals - a.signals ||
      a.label.localeCompare(b.label),
  );
}

/**
 * Whole days from `today` to `kickoff`, or null if either date is unusable.
 * Negative once kickoff has passed, so the caller can say "kickoff was" rather
 * than counting down into the past.
 */
export function daysUntil(kickoff: string, today: string): number | null {
  const end = Date.parse(`${kickoff}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return Math.round((end - start) / 86_400_000);
}

/** Said on the panel, not buried in a tooltip. */
export const NEXT_SEASON_DISCLAIMER =
  "These are your own team's notes, grouped. Vantage does not guess the game: nothing here comes from anywhere except what someone on your team wrote down and where they saw it.";

export const NEXT_SEASON_EMPTY =
  "Nothing recorded yet. When someone spots a teaser, or notices what this year's FTC game asks robots to do, add it here with a link so it is still findable in January.";
