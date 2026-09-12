/**
 * Labeled Onshape drawing packs: views, callouts, and notes a person can CAD
 * from. Multiple sheets per part when faces need their own millimetres.
 * Never invents a dimension.
 */
import type { DrawingDimensions } from "./drawing-first";

export const DRAWING_VIEW_KINDS = ["front", "top", "side", "iso"] as const;
export type DrawingViewKind = (typeof DRAWING_VIEW_KINDS)[number];

export type DrawingCallout = {
  label: string;
  valueMm: number;
  view: DrawingViewKind;
};

export type DrawingSheet = {
  name: string;
  purpose: string;
  views: DrawingViewKind[];
  callouts: DrawingCallout[];
  notes: string[];
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
};

function finitePositiveMm(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return number;
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function callout(label: string, valueMm: number | undefined, view: DrawingViewKind): DrawingCallout | undefined {
  if (valueMm === undefined) return undefined;
  return { label, valueMm, view };
}

function noteLine(label: string, valueMm: number | undefined): string | undefined {
  if (valueMm === undefined) return undefined;
  return `${label}: ${formatMm(valueMm)} mm`;
}

/**
 * Plan one or more labeled drawing sheets from confirmed millimetres.
 * Missing sizes stay missing. Never invents a plate.
 */
export function planDrawingPack(input: {
  partName?: string;
  dims: DrawingDimensions;
  briefSummary?: string;
}): DrawingSheet[] {
  const widthMm = finitePositiveMm(input.dims.widthMm);
  const heightMm = finitePositiveMm(input.dims.heightMm);
  const depthMm = finitePositiveMm(input.dims.depthMm);
  const part = (input.partName ?? "Part").trim() || "Part";
  const summary = (input.briefSummary ?? "").trim();
  const hasAny = widthMm !== undefined || heightMm !== undefined || depthMm !== undefined;
  const distinctFaces =
    [widthMm, heightMm, depthMm].filter((value, index, all) => value !== undefined && all.indexOf(value) === index)
      .length >= 2;
  const mentionsHoles = /\b(hole|bolt|pattern|grid)\b/i.test(summary);

  const howToCad = hasAny
    ? "A person can CAD from these labels: sketch the named view, then cast the solid from the same millimetres."
    : "Ask for controlling millimetres before sketching. Do not invent sizes.";

  const profileCallouts = [
    callout("Width", widthMm, "front"),
    callout("Height", heightMm, "front"),
    callout("Width", widthMm, "top"),
    callout("Depth", depthMm, "top"),
  ].filter((item): item is DrawingCallout => Boolean(item));

  const profileNotes = [
    noteLine("Width", widthMm),
    noteLine("Height", heightMm),
    noteLine("Depth", depthMm),
    howToCad,
  ].filter((item): item is string => Boolean(item));

  const profile: DrawingSheet = {
    name: `${part} — front and top`,
    purpose: "Labeled front and top so a person can sketch the outline from the millimetres.",
    views: ["front", "top", "iso"],
    callouts: profileCallouts,
    notes: profileNotes,
    ...(widthMm !== undefined ? { widthMm } : {}),
    ...(heightMm !== undefined ? { heightMm } : {}),
    ...(depthMm !== undefined ? { depthMm } : {}),
  };

  if (!distinctFaces && !mentionsHoles) {
    return [profile];
  }

  const sheets: DrawingSheet[] = [profile];

  if (distinctFaces) {
    const sideCallouts = [
      callout("Height", heightMm, "side"),
      callout("Depth", depthMm, "side"),
    ].filter((item): item is DrawingCallout => Boolean(item));
    sheets.push({
      name: `${part} — side`,
      purpose: "Second sheet for the side face so thickness is labeled on its own drawing.",
      views: ["side", "iso"],
      callouts: sideCallouts,
      notes: [noteLine("Height", heightMm), noteLine("Depth", depthMm), howToCad].filter(
        (item): item is string => Boolean(item),
      ),
      ...(widthMm !== undefined ? { widthMm } : {}),
      ...(heightMm !== undefined ? { heightMm } : {}),
      ...(depthMm !== undefined ? { depthMm } : {}),
    });
  }

  if (mentionsHoles && hasAny) {
    sheets.push({
      name: `${part} — holes`,
      purpose: "Hole sheet. Only sizes already in the brief. Do not invent hole spacing.",
      views: ["front", "top"],
      callouts: profileCallouts.filter((item) => item.view === "front" || item.view === "top"),
      notes: [
        "Label every hole from the brief only.",
        howToCad,
      ],
      ...(widthMm !== undefined ? { widthMm } : {}),
      ...(heightMm !== undefined ? { heightMm } : {}),
      ...(depthMm !== undefined ? { depthMm } : {}),
    });
  }

  return sheets;
}

export function drawingSheetParameters(sheet: DrawingSheet): Record<string, unknown> {
  return {
    name: sheet.name,
    purpose: sheet.purpose,
    views: sheet.views,
    callouts: sheet.callouts,
    notes: sheet.notes,
    ...(sheet.widthMm !== undefined ? { widthMm: sheet.widthMm } : {}),
    ...(sheet.heightMm !== undefined ? { heightMm: sheet.heightMm } : {}),
    ...(sheet.depthMm !== undefined ? { depthMm: sheet.depthMm } : {}),
  };
}

export function parseDrawingViews(value: unknown): DrawingViewKind[] {
  if (!Array.isArray(value)) return [];
  const views: DrawingViewKind[] = [];
  for (const entry of value) {
    const kind = String(entry ?? "").trim().toLowerCase();
    if ((DRAWING_VIEW_KINDS as readonly string[]).includes(kind) && !views.includes(kind as DrawingViewKind)) {
      views.push(kind as DrawingViewKind);
    }
  }
  return views;
}

export function parseDrawingNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

export function parseDrawingCallouts(value: unknown): DrawingCallout[] {
  if (!Array.isArray(value)) return [];
  const callouts: DrawingCallout[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const valueMm = finitePositiveMm(record.valueMm);
    const view = String(record.view ?? "").trim().toLowerCase();
    const label = String(record.label ?? "").trim();
    if (!label || valueMm === undefined || !(DRAWING_VIEW_KINDS as readonly string[]).includes(view)) continue;
    callouts.push({ label, valueMm, view: view as DrawingViewKind });
  }
  return callouts;
}
