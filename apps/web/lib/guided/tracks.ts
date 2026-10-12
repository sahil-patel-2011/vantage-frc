import { FRC6925_TRACKS } from "./tracks-6925";
import { GIT_TRACKS } from "./tracks-git";
import { ONSHAPE_TRACKS } from "./tracks-onshape";
import type { GuidedStep, GuidedTrack } from "./types";

/* The tracks live in their own files: Onshape (tracks-onshape.ts), Git and GitHub (tracks-git.ts)
   and Team 6925 (tracks-6925.ts). */
export const GUIDED_TRACKS: GuidedTrack[] = [...ONSHAPE_TRACKS, ...GIT_TRACKS, ...FRC6925_TRACKS];

/**
 * Two or three words for a column heading: Team progress puts every track side by side, and the
 * full titles made ten 130px-wide columns on a phone.
 */
const SHORT_TITLES: Record<string, string> = {
  "onshape-first-part": "First part",
  "onshape-first-assembly": "Assembly",
  "onshape-sheet-metal": "Sheet metal",
  "onshape-drawing": "Drawing",
  "onshape-cots": "COTS parts",
  "onshape-belt-layout": "Belt layout",
  "git-first-pr": "Git",
  "frc6925-programming": "6925 Prog",
  "frc6925-mechanical": "6925 Mech",
};

export function guidedTrackShortTitle(track: Pick<GuidedTrack, "id" | "title">): string {
  return SHORT_TITLES[track.id] ?? track.title;
}

export function guidedTrack(id: string): GuidedTrack | null {
  return GUIDED_TRACKS.find((track) => track.id === id) ?? null;
}

export function guidedStep(trackId: string, stepId: string): GuidedStep | null {
  return guidedTrack(trackId)?.steps.find((step) => step.id === stepId) ?? null;
}
