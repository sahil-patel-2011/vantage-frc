/**
 * Dry run: everything the agent needs to inspect a part BEFORE any Onshape call.
 *
 * `dryRunPart` performs zero network access by construction — it only calls the
 * pure generator. That is what lets the local DFM checks (minimum wall, hole-to-
 * edge, insert depth, bed size, printer hole compensation) and the user both look
 * at the part while the Onshape API-key quota is still untouched.
 */

import { generatePartFeatureScript, type GenerateOptions, type GeneratedPartFeature } from "./generate";
import type { PartDefinition } from "./part-schema";

export type OnshapeCallStep = {
  label: string;
  /** How the transport makes it; the session-REST path is the one that avoids the API-key quota. */
  method: "POST" | "GET";
  calls: number;
};

export type OnshapeCallPlan = {
  steps: OnshapeCallStep[];
  total: number;
  note: string;
};

export type PartPreview = GeneratedPartFeature & {
  /** Always 0. A dry run is the whole point of this module. */
  onshapeCallsMade: 0;
  /** What pushing this part would cost, so the caller can decide before spending. */
  callPlan: OnshapeCallPlan;
};

export type DryRunOptions = GenerateOptions & {
  /**
   * True when this document has no Vantage Feature Studio yet, so the push has to
   * create one. A team's second part in the same document skips that step.
   */
  freshDocument?: boolean;
  /** Skip the bounding-box + iso-view pull. Only sensible when re-verifying later. */
  skipVerification?: boolean;
};

/**
 * Call budget for pushing a generated part.
 *
 * These are the calls this generator's output implies. The transport layer owns
 * the real count and is the authority on which credential each call uses; a
 * signed-in browser session is what keeps them off the annual API-key quota.
 */
export function estimateOnshapeCalls(options: DryRunOptions = {}): OnshapeCallPlan {
  const steps: OnshapeCallStep[] = [];
  if (options.freshDocument !== false) {
    steps.push({ label: "Create the Vantage Feature Studio", method: "POST", calls: 1 });
  }
  steps.push(
    { label: "Write the generated FeatureScript into the Feature Studio", method: "POST", calls: 1 },
    { label: "Read the Feature Studio microversion for the feature namespace", method: "GET", calls: 1 },
    { label: "Insert the custom feature into the Part Studio", method: "POST", calls: 1 },
  );
  if (!options.skipVerification) {
    steps.push(
      { label: "Bounding-box FeatureScript readback", method: "POST", calls: 1 },
      { label: "One iso shaded view", method: "GET", calls: 1 },
    );
  }
  const total = steps.reduce((sum, step) => sum + step.calls, 0);
  return {
    steps,
    total,
    note:
      "One feature builds the whole solid, so the count does not grow with the number of holes, ribs or fillets. A later dimension change is 1 call to update the existing feature plus the 2 verification calls.",
  };
}

/** Generate and inspect a part without touching the network. */
export function dryRunPart(definition: PartDefinition, options: DryRunOptions = {}): PartPreview {
  const generated = generatePartFeatureScript(definition, options);
  return { ...generated, onshapeCallsMade: 0, callPlan: estimateOnshapeCalls(options) };
}

function mm(value: number): string {
  return `${Number(value.toFixed(3))} mm`;
}

/** Plain-text summary for the agent transcript and the approval prompt. */
export function describePartPreview(preview: PartPreview): string {
  const { geometry } = preview;
  const lines: string[] = [
    `${preview.featureTypeName} — one FeatureScript feature (${preview.featureTypeId}), FeatureScript ${preview.featureScriptVersion}`,
    `Bounding box ${mm(geometry.sizeMm.xMm)} x ${mm(geometry.sizeMm.yMm)} x ${mm(geometry.sizeMm.zMm)}`,
    `Parameters ${preview.parameters.length} · deterministic ids ${preview.ids.length} · source ${preview.sourceBudget.used.toLocaleString("en-US")}/${preview.sourceBudget.limit.toLocaleString("en-US")} chars`,
  ];

  if (geometry.holes.length) {
    const byGroup = new Map<string, number>();
    for (const hole of geometry.holes) byGroup.set(hole.holeId, (byGroup.get(hole.holeId) ?? 0) + 1);
    const groups = [...byGroup.entries()].map(([holeId, count]) => {
      const first = geometry.holes.find((hole) => hole.holeId === holeId)!;
      const bore = first.counterboreDiameterMm ? `, counterbore ${mm(first.counterboreDiameterMm)} x ${mm(first.counterboreDepthMm ?? 0)}` : "";
      return `${count} x ${mm(first.diameterMm)} "${holeId}"${first.through ? " through" : ` blind ${mm(first.depthMm ?? 0)}`}${bore}`;
    });
    lines.push(`Holes: ${groups.join("; ")}`);
    lines.push(
      `Hole centres (mm, origin at the base centre): ${geometry.holes
        .slice(0, 12)
        .map((hole) => `${hole.holeId}[${hole.index}] (${Number(hole.xMm.toFixed(3))}, ${Number(hole.yMm.toFixed(3))})`)
        .join(", ")}${geometry.holes.length > 12 ? `, +${geometry.holes.length - 12} more` : ""}`,
    );
  } else {
    lines.push("Holes: none.");
  }

  lines.push(
    `Approx solid volume ${Number(geometry.approxSolidVolumeMm3.toFixed(1)).toLocaleString("en-US")} mm3 — estimate only: ${geometry.volumeCaveats[0]}`,
  );
  lines.push(`Push cost: ${preview.callPlan.total} Onshape calls. ${preview.callPlan.note}`);
  for (const warning of preview.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}
