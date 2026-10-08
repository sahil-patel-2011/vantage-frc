import type { Page } from "playwright";

export type UiAction = "click" | "double-click" | "right-click" | "fill" | "select" | "press" | "canvas-click";
export type UiLocator =
  | { kind: "role"; role: Parameters<Page["getByRole"]>[0]; name: string; scope?: string }
  | { kind: "label"; label: string }
  | { kind: "testId"; testId: string }
  | { kind: "text"; text: string; scope?: string }
  /** Dynamic names are observed from these trusted tree nodes before selection. */
  | { kind: "named-item"; scope: string; itemSelector: string }
  /** Only trusted, observed atlas entries may supply CSS, never tool input. */
  | { kind: "css"; selector: string };

export type UiControl = {
  locator: UiLocator;
  scope: "documents" | "document";
  allowedActions: readonly UiAction[];
  impact: "inspect" | "edit" | "destructive";
  /** Explicit subset of the engine's safe keys; no free-form key chords. */
  allowedKeys?: readonly string[];
  canvas?: boolean;
};

export type UiDocumentBinding = {
  origin: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
};

export type UiBounds = { x: number; y: number; width: number; height: number };
export type UiObservation = {
  id: string;
  at: number;
  url: string;
  aria: string;
  screenshotBase64: string;
  viewport: { width: number; height: number };
  controls: Record<string, { visible: boolean; enabled: boolean; count: number; names?: string[] }>;
  canvasBounds: Record<string, UiBounds>;
};

export type UiPostcondition =
  | { controlId: string; kind: "visible" | "hidden" }
  | { controlId: string; kind: "value" | "text"; expected: string };

export type UiCommand = {
  observationId: string;
  controlId: string;
  action: UiAction;
  value?: string;
  key?: string;
  /** Exact rendered name previously observed in a named-item registry control. */
  targetText?: string;
  /** CSS pixels relative to the latest viewport screenshot, not the canvas. */
  x?: number;
  y?: number;
  postcondition?: UiPostcondition;
};

export type UiAuthorizationContext = {
  operation: "observe" | "bind" | "execute";
  binding: UiDocumentBinding | null;
  command?: UiCommand;
};

export type OnshapeUiEngineOptions = {
  page: Page;
  controls: Readonly<Record<string, UiControl>>;
  /** Must validate current server-backed pilot membership; throw on refusal. */
  authorize: (context: UiAuthorizationContext) => Promise<void>;
  /** Bound to the exact command by the host; never a model-supplied Boolean. */
  approveDestructive?: (context: UiAuthorizationContext) => Promise<void>;
  now?: () => number;
  observationMaxAgeMs?: number;
};

export type UiCommandResult = {
  status: "verified" | "unverified";
  actionPerformed: boolean;
  /** This verifies UI evidence only, never certifies model geometry. */
  verification: "ui-postcondition" | "none";
  message: string;
  observation: UiObservation;
};
