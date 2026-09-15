import {
  cadStepPaneCopy,
  classifyCadStepPane,
  labelCadStepStatus,
} from "../../lib/cad/cad-step-pane";
import type { AgentStep } from "./cad-model";

/**
 * The narrated build log for the current session. Each line is the tool's own
 * wording ("Drilled 4× ⌀5 mm through holes"), so a student can read what was
 * built without opening Onshape.
 */
export function CadStepPane({
  steps,
  setupRequired = false,
  bound = false,
}: {
  steps: AgentStep[];
  setupRequired?: boolean;
  bound?: boolean;
}) {
  const kind = classifyCadStepPane({
    setupRequired,
    bound,
    stepCount: steps.length,
  });
  switch (kind) {
    case "hidden":
      return null;
    case "setup": {
      const copy = cadStepPaneCopy("setup");
      return (
        <div className="cad-step-panel">
          <b>Build steps</b>
          <p className="cad-step-empty">
            <span className="cad-step-setup-badge">{copy.badge}</span>
            {copy.description}
          </p>
        </div>
      );
    }
    case "empty": {
      const copy = cadStepPaneCopy("empty");
      return (
        <div className="cad-step-panel">
          <b>Build steps</b>
          <p className="cad-step-empty">{copy.description}</p>
        </div>
      );
    }
    case "ready": {
      const failed = steps.filter((step) => step.status === "failed").length;
      return (
        <div className="cad-step-panel">
          <b>
            Build steps — {steps.length} step{steps.length === 1 ? "" : "s"}
            {failed ? `, ${failed} with an error` : ""}
          </b>
          <ol className="cad-step-list">
            {steps.map((step) => (
              <li
                key={`step-${step.index}`}
                className={`cad-step cad-step--${step.status} qol-stagger-row`}
                style={{ ["--qol-i" as string]: step.index }}
              >
                <span className="cad-step-index">{step.index}</span>
                <span className="cad-step-body">
                  <span className="cad-step-title">{step.title}</span>
                  {step.detail ? <span className="cad-step-detail">{step.detail}</span> : null}
                </span>
                <span className="cad-step-status">{labelCadStepStatus(step.status)}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}
