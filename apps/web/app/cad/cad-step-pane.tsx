import type { AgentStep } from "./cad-model";

/**
 * The narrated build log for the current session. Each line is the tool's own
 * wording ("Drilled 4× ⌀5 mm through holes"), so a student can read what was
 * built without opening Onshape.
 */
export function CadStepPane({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  const failed = steps.filter((step) => step.status === "failed").length;
  return (
    <div className="cad-step-panel">
      <b>
        Build steps — {steps.length} step{steps.length === 1 ? "" : "s"}
        {failed ? `, ${failed} failed` : ""}
      </b>
      <ol className="cad-step-list">
        {steps.map((step) => (
          <li key={`step-${step.index}`} className={`cad-step cad-step--${step.status}`}>
            <span className="cad-step-index">{step.index}</span>
            <span className="cad-step-body">
              <span className="cad-step-title">{step.title}</span>
              {step.detail ? <span className="cad-step-detail">{step.detail}</span> : null}
            </span>
            <span className="cad-step-status">{step.status === "failed" ? "Failed" : "Done"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
