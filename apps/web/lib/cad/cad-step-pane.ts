export type CadStepPaneKind = "hidden" | "setup" | "empty" | "ready";

export function classifyCadStepPane(input: {
  setupRequired: boolean;
  bound: boolean;
  stepCount: number;
}): CadStepPaneKind {
  if (input.setupRequired) return "setup";
  if (input.stepCount > 0) return "ready";
  if (!input.bound) return "hidden";
  return "empty";
}

export function cadStepPaneCopy(kind: "setup" | "empty"): {
  badge: string | null;
  title: string;
  description: string;
} {
  switch (kind) {
    case "setup":
      return {
        badge: "Needs setup",
        title: "Connect Onshape to see build steps",
        description: "The narrated build log appears after Onshape is connected and a document is bound.",
      };
    case "empty":
      return {
        badge: null,
        title: "No build steps yet",
        description: "Steps appear here as the CAD agent writes features in Onshape.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function labelCadStepStatus(status: string): string {
  switch (status) {
    case "done":
      return "Done";
    case "failed":
      return "Error";
    case "setup_required":
      return "Needs setup";
    default:
      return status.replaceAll("_", " ");
  }
}
