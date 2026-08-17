"use client";

import { useMemo, useState } from "react";

const ALL_OPERATIONS = [
  "create_sketch","create_extrude","create_fillet","create_chamfer","create_shell","create_pattern",
  "set_variable","create_assembly","feature_script","verify_topology","render_views","create_checkpoint",
  "rollback_checkpoint","export_step","export_stl","export_gltf",
] as const;
const FUSION_OPERATIONS = [
  "create_sketch",
  "create_extrude",
  "create_fillet",
  "create_chamfer",
  "create_shell",
  "create_pattern",
  "set_variable",
  "create_assembly",
  "verify_topology",
  "render_views",
  "create_checkpoint",
  "rollback_checkpoint",
  "export_step",
  "export_stl",
  "export_gltf",
] as const;

const STARTERS: Record<string, Record<string, unknown>> = {
  create_sketch: { plane: "Top", profile: "Describe the dimensioned closed profile", units: "mm" },
  create_extrude: { depth: "25 mm", direction: "new" },
  create_fillet: { radius: "3 mm", entities: ["select after describe/list entities"] },
  create_chamfer: { distance: "1 mm", entities: ["select after describe/list entities"] },
  create_shell: { thickness: "2 mm", openFaces: ["select after describe/list entities"] },
  create_pattern: { count: 4, spacing: "25 mm", direction: "x" },
  set_variable: { name: "wallThickness", value: "2 mm" },
  create_assembly: { name: "Mechanism assembly", instances: [] },
  feature_script: { source: "// Paste reviewed FeatureScript source", parameters: {} },
  verify_topology: { views: ["iso", "top", "front"], explainForStudents: true },
  render_views: { views: ["iso", "top", "front"] },
  create_checkpoint: { label: "Reviewed checkpoint" },
  rollback_checkpoint: { checkpointRef: "select a prior checkpoint" },
  export_step: { format: "STEP" },
  export_stl: { format: "STL" },
  export_gltf: { format: "GLTF" },
};

export function CadOperationComposer({
  platform,
  disabled,
  onAppend,
}: {
  platform: string;
  disabled: boolean;
  onAppend: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const operations = useMemo(
    () => (platform === "fusion360" ? [...FUSION_OPERATIONS] : [...ALL_OPERATIONS]),
    [platform],
  );
  const [operation, setOperation] = useState<string>(operations[0] ?? "verify_topology");
  const [parameters, setParameters] = useState(() => JSON.stringify(STARTERS[operation], null, 2));
  const [reason, setReason] = useState("Add a small, reversible feature and verify it before continuing.");
  const [error, setError] = useState("");

  function choose(next: string) {
    setOperation(next);
    setParameters(JSON.stringify(STARTERS[next] ?? {}, null, 2));
    setError("");
  }

  return (
    <details className="cad-operation-studio">
      <summary>
        <div><span className="eyebrow">MANIPULATION STUDIO</span><strong>Add an API operation</strong></div>
        <span className={`app-badge ${platform === "onshape" ? "good" : "setup"}`}>
          {platform === "onshape" ? "Hosted API" : platform === "fusion360" ? "Local add-in" : "Demo adapter"}
        </span>
      </summary>
      <div className="cad-operation-body">
        <p className="app-muted">
          {platform === "fusion360"
            ? "Operations listed here match the paired Fusion add-in allowlist. Execution occurs on your desktop."
            : platform === "onshape"
              ? "Operations execute through the bound Onshape document after approval, then return a render and topology checkpoint."
              : "Mock operations prove the approval and verification loop; they are not production geometry."}
        </p>
        <div className="cad-operation-grid">
          <label>Operation<select value={operation} onChange={(e) => choose(e.target.value)}>{operations.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
          <label>Engineering reason<input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
        <label>Parameters (explicit units; use described entity IDs)<textarea rows={8} value={parameters} onChange={(e) => setParameters(e.target.value)} spellCheck={false} /></label>
        {error ? <p className="telemetry-status" role="alert">{error}</p> : null}
        <button
          type="button"
          className="app-button"
          disabled={disabled}
          onClick={() => {
            try {
              const parsed = JSON.parse(parameters) as unknown;
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Parameters must be a JSON object");
              setError("");
              void onAppend({ operation, parameters: parsed, reason });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Parameters must be valid JSON");
            }
          }}
        >
          Add reviewed operation to plan
        </button>
      </div>
    </details>
  );
}
