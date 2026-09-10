"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/ui";

export type CadToolRow = {
  name: string;
  label: string;
  group: string;
  description: string;
  onshape: "supported" | "unsupported";
  fusion: "supported" | "unsupported";
  fusionOperation: string | null;
  fusionNote: string | null;
  mutating: boolean;
};

const TOOL_GROUP_LABELS: Record<string, string> = {
  session: "Session",
  sketch: "Sketch",
  solid: "Solid",
  modify: "Modify",
  pattern: "Pattern",
  assembly: "Assembly",
  inspect: "Inspect",
};

/**
 * What the agent can and cannot do, stated BEFORE anyone asks for it.
 *
 * The point of this panel is the "Onshape only" badge: the Fusion add-in
 * implements eight operations, and a CAD lead should read that here rather than
 * discover it when a fillet fails three steps into a build. `fusionNote` also
 * carries the partial cases (Fusion fillets every edge; Onshape can do corners
 * only), which are shown on supported tools too.
 */
export function CadToolsPanel({ tools }: { tools: CadToolRow[] }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const byGroup = new Map<string, CadToolRow[]>();
    for (const tool of tools) {
      const list = byGroup.get(tool.group) ?? [];
      list.push(tool);
      byGroup.set(tool.group, list);
    }
    return [...byGroup.entries()];
  }, [tools]);

  if (!tools.length) return null;

  return (
    <section className="cad-activity cad-tools" aria-label="CAD tools">
      <div className="cad-activity-head">
        <span>Tools — {tools.length} operations</span>
        <Button variant="secondary" type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide tools" : "Show tools"}
        </Button>
      </div>
      {open ? (
        <div className="cad-tools-body">
          <p className="cad-activity-empty">
            This page runs the Onshape half. Fusion 360 needs the local VantageCadRelay add-in on your PC, so tools
            marked <b>Onshape only</b> cannot run here or from a Fusion session.
          </p>
          {groups.map(([group, list]) => (
            <div key={group} className="cad-tools-group">
              <h3>{TOOL_GROUP_LABELS[group] ?? group}</h3>
              <ul>
                {list.map((tool) => (
                  <li key={tool.name} className="cad-tool">
                    <span className="cad-tool-head">
                      <code>{tool.name}</code>
                      {tool.onshape === "supported" && tool.fusion === "unsupported" ? (
                        <span className="cad-tool-badge cad-tool-badge--onshape">Onshape only</span>
                      ) : null}
                      {tool.onshape === "unsupported" && tool.fusion === "supported" ? (
                        <span className="cad-tool-badge cad-tool-badge--fusion">Fusion only</span>
                      ) : null}
                    </span>
                    <span className="cad-tool-desc">{tool.description}</span>
                    {tool.fusionNote ? <span className="cad-tool-note">Fusion: {tool.fusionNote}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
