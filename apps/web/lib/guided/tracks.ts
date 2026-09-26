import { FRC6925_TRACKS } from "./tracks-6925";
import { ONSHAPE_TRACKS } from "./tracks-onshape";
import type { GuidedStep, GuidedTrack } from "./types";

/* The tracks live in their own files: Onshape (tracks-onshape.ts) and Team 6925 (tracks-6925.ts). */
export const GUIDED_TRACKS: GuidedTrack[] = [...ONSHAPE_TRACKS, ...FRC6925_TRACKS];

export function guidedTrack(id: string): GuidedTrack | null {
  return GUIDED_TRACKS.find((track) => track.id === id) ?? null;
}

export function guidedStep(trackId: string, stepId: string): GuidedStep | null {
  return guidedTrack(trackId)?.steps.find((step) => step.id === stepId) ?? null;
}
