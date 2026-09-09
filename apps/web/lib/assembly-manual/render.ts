import { ISO_VIEW_MATRIX, type OnshapeHttp } from "@vantage/cad";
import { shadedViewFromOnshape } from "../cad/shaded-view";

/**
 * Step pictures.
 *
 * Every image in the manual is a shaded view Onshape rendered of the team's own
 * geometry. There is no generated illustration, no stand-in cube, no "here is
 * roughly what a gearbox looks like". When a render cannot be produced the step
 * carries a labelled placeholder that says exactly which call failed and what
 * to do — a blank with a sentence is honest; a generic picture of a different
 * robot is not.
 *
 * THE OCCURRENCE-HIDING PROBLEM, STATED PLAINLY
 *
 * The ideal step picture is the partial assembly: everything placed so far,
 * with this step's new parts standing out. Onshape's documented assembly
 * shaded-view endpoint takes a view matrix and a size, and does not document a
 * way to hide occurrences for one render. So this module tries, in order:
 *
 *   1. POST the assembly shaded view with a hidden-occurrence body. If the API
 *      accepts it, the step gets exactly the picture it wants
 *      (mode `assembly_hidden`).
 *   2. GET the whole assembly shaded view — every part visible. Correct
 *      geometry, no step isolation (mode `assembly_full`). Fetched once and
 *      reused for every step, because it is the same image each time.
 *   3. A shaded view of the individual part being added (mode `part`). This is
 *      what a parts-callout picture should be anyway.
 *   4. Nothing, with the reason (mode `none`).
 *
 * The mode used is stored per step and printed in the run report, so a reader
 * always knows whether they are looking at the partial build or at the whole
 * robot. That is the difference between a limitation and a lie.
 */

export type ShadedViewSize = {
  widthPx?: number;
  heightPx?: number;
};

export type RenderMode = "assembly_hidden" | "assembly_full" | "part" | "none";

export type StepRender = {
  pngBase64: string | null;
  mode: RenderMode;
  /** Printed verbatim under the image. Empty only when mode is a real render. */
  note: string;
};

function sizeQuery(size: ShadedViewSize): URLSearchParams {
  const width = Math.round(size.widthPx ?? 900);
  const height = Math.round(size.heightPx ?? 700);
  if (width < 32 || width > 2000 || height < 32 || height > 2000) {
    throw new Error("Shaded-view width and height must be between 32 and 2000 pixels.");
  }
  return new URLSearchParams({
    outputWidth: String(width),
    outputHeight: String(height),
    pixelSize: "0",
    viewMatrix: ISO_VIEW_MATRIX,
    useAntiAliasing: "true",
    includeSurfaces: "false",
  });
}

export type AssemblyViewRef = {
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export function assemblyShadedViewPath(ref: AssemblyViewRef, size: ShadedViewSize = {}): string {
  return (
    `/assemblies/d/${encodeURIComponent(ref.documentId)}/w/${encodeURIComponent(ref.workspaceId)}` +
    `/e/${encodeURIComponent(ref.elementId)}/shadedviews?${sizeQuery(size).toString()}`
  );
}

export type PartViewRef = {
  documentId: string;
  wvm: "w" | "m" | "v";
  wvmId: string;
  elementId: string;
  partId: string;
};

export function partShadedViewPath(ref: PartViewRef, size: ShadedViewSize = {}): string {
  return (
    `/parts/d/${encodeURIComponent(ref.documentId)}/${ref.wvm}/${encodeURIComponent(ref.wvmId)}` +
    `/e/${encodeURIComponent(ref.elementId)}/partid/${encodeURIComponent(ref.partId)}` +
    `/shadedviews?${sizeQuery(size).toString()}`
  );
}

async function readShadedView(
  http: OnshapeHttp,
  path: string,
  init?: RequestInit,
): Promise<{ pngBase64: string | null; message: string }> {
  let response: Response;
  try {
    response = await http(path, init);
  } catch (error) {
    return { pngBase64: null, message: error instanceof Error ? error.message : "the request failed" };
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (/image\/png|octet-stream/i.test(contentType)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = shadedViewFromOnshape({ status: response.status, bytes });
    return { pngBase64: view.pngBase64, message: view.status === "ready" ? "" : view.message };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const view = shadedViewFromOnshape({ status: response.status, body: body ?? null });
  return { pngBase64: view.pngBase64, message: view.status === "ready" ? "" : view.message };
}

export type RenderStepInput = {
  http: OnshapeHttp;
  assembly: AssemblyViewRef;
  /** Occurrence ids to hide — everything not yet placed. */
  hiddenInstanceIds: string[];
  /** The part being added, when it resolved to a real Part Studio part. */
  part: PartViewRef | null;
  partName: string;
  size?: ShadedViewSize;
  /**
   * Whole-assembly render, fetched once by the caller. Passing it avoids one
   * Onshape call per step, which on a 200-step robot is the difference between
   * a run that finishes and one that gets rate-limited.
   */
  fullAssemblyPng?: string | null;
  /**
   * False once a POST attempt has been refused, so the engine does not retry a
   * capability this Onshape deployment does not have on every one of 200 steps.
   */
  tryHiddenOccurrences?: boolean;
};

export type RenderStepOutput = StepRender & {
  /** False when the hidden-occurrence POST was refused; the caller stops trying. */
  hiddenOccurrencesSupported: boolean;
};

export async function renderStep(input: RenderStepInput): Promise<RenderStepOutput> {
  const size = input.size ?? {};
  let hiddenOccurrencesSupported = input.tryHiddenOccurrences !== false;
  const failures: string[] = [];

  if (hiddenOccurrencesSupported && input.hiddenInstanceIds.length) {
    const attempt = await readShadedView(input.http, assemblyShadedViewPath(input.assembly, size), {
      method: "POST",
      body: JSON.stringify({
        hiddenInstances: input.hiddenInstanceIds,
        hiddenOccurrences: input.hiddenInstanceIds.map((id) => [id]),
      }),
    });
    if (attempt.pngBase64) {
      return { pngBase64: attempt.pngBase64, mode: "assembly_hidden", note: "", hiddenOccurrencesSupported: true };
    }
    // One refusal is enough: this Onshape does not take a hidden-occurrence
    // body, and asking again on every step would just burn the rate limit.
    hiddenOccurrencesSupported = false;
    failures.push(`per-step occurrence hiding is not available on this Onshape API (${attempt.message || "refused"})`);
  }

  if (input.part) {
    const attempt = await readShadedView(input.http, partShadedViewPath(input.part, size));
    if (attempt.pngBase64) {
      return {
        pngBase64: attempt.pngBase64,
        mode: "part",
        note: `Shows "${input.partName}" on its own — ${failures[0] ?? "the partial assembly could not be rendered"}.`,
        hiddenOccurrencesSupported,
      };
    }
    failures.push(`the part view failed (${attempt.message || "no image"})`);
  } else {
    failures.push("this instance does not resolve to a single Part Studio part, so it has no part view");
  }

  if (input.fullAssemblyPng) {
    return {
      pngBase64: input.fullAssemblyPng,
      mode: "assembly_full",
      note: `Shows the complete assembly, not this step: ${failures.join("; ")}.`,
      hiddenOccurrencesSupported,
    };
  }

  return {
    pngBase64: null,
    mode: "none",
    note: `No Onshape render for this step: ${failures.join("; ")}. Open the assembly in Onshape to see it.`,
    hiddenOccurrencesSupported,
  };
}

/** The cover picture: the finished assembly, once. */
export async function renderWholeAssembly(
  http: OnshapeHttp,
  assembly: AssemblyViewRef,
  size: ShadedViewSize = {},
): Promise<StepRender> {
  const attempt = await readShadedView(http, assemblyShadedViewPath(assembly, size));
  if (attempt.pngBase64) return { pngBase64: attempt.pngBase64, mode: "assembly_full", note: "" };
  return {
    pngBase64: null,
    mode: "none",
    note: `Onshape returned no shaded view of the finished assembly: ${attempt.message || "no image"}.`,
  };
}
