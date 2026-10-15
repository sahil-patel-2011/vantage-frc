/**
 * Guided steps that only Onshape can check, and what a step says when Onshape is not switched on
 * for this deployment. Without this, the connect step told students to connect, and Check my work
 * then answered "Onshape connections aren't switched on" — a dead end. Now the step says so before
 * they start and offers the way forward: a lead's sign-off, or the DXF checker for drawings.
 */

import { isOnshapeApiCheck } from "./checks-onshape";
import type { StepCheck } from "./types";

/** True for a step whose check reads the student's Onshape account or document. */
export function stepNeedsOnshape(check: StepCheck): boolean {
  return (
    check.kind === "onshape-connected" ||
    check.kind === "onshape-features" ||
    check.kind === "onshape-mass" ||
    isOnshapeApiCheck(check)
  );
}

/** Tracks whose finished work is a drawing: a DXF export can be checked without Onshape. */
const DRAWING_TRACKS = new Set(["onshape-drawing"]);

export type OnshapeOffNotice = {
  title: string;
  body: string;
  /** The CAD checker, for steps whose work can be exported as a DXF drawing and checked now. */
  dxf: { text: string; href: string } | null;
};

export function onshapeOffNotice(trackId: string, check: StepCheck): OnshapeOffNotice {
  const connect = check.kind === "onshape-connected";
  const drawing = DRAWING_TRACKS.has(trackId) && !connect;
  return {
    title: "Vantage can't read Onshape yet",
    body: connect
      ? "Onshape isn't switched on for Vantage yet, so there's nothing to connect. Make your Onshape account anyway and keep going; show a lead your account and ask them to sign this step off."
      : "Onshape isn't switched on for Vantage yet, so Vantage can't read your document for this step. Do the step in Onshape, then show a lead and ask them to sign it off.",
    dxf: drawing
      ? { text: "Want a check now? In Onshape right-click the Drawing tab, export it as DXF, and run it through the CAD checker.", href: "/cad-checker" }
      : null,
  };
}

/**
 * The server only accepts a sign-off request for an Onshape step while Onshape is off: when it is
 * on, the real check is the way to pass.
 */
export function canAskLeadInsteadOfOnshape(check: StepCheck, onshapeConfigured: boolean): boolean {
  return !onshapeConfigured && stepNeedsOnshape(check);
}
