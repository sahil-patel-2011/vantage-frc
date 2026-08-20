import { CLAUDE_CAD_INSTRUCTIONS, callClaudeCadTool } from "@vantage/cad";

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function numFlag(name: string, fallback: number) {
  const raw = flag(name);
  const n = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function runClaudeCadCli(command: string, subcommand = "") {
  if (command === "claude") {
    console.log(CLAUDE_CAD_INSTRUCTIONS);
    printJson(await callClaudeCadTool("cad_status"));
    return;
  }
  if (command === "onshape") {
    if (subcommand === "docs" || subcommand === "documents") {
      printJson(await callClaudeCadTool("onshape_list_documents", { limit: numFlag("limit", 12) }));
      return;
    }
    if (subcommand === "elements") {
      printJson(
        await callClaudeCadTool("onshape_list_elements", {
          documentId: flag("document") ?? "",
          workspaceId: flag("workspace") ?? "",
        }),
      );
      return;
    }
    if (subcommand === "bind") {
      printJson(
        await callClaudeCadTool("onshape_bind", {
          documentId: flag("document") ?? "",
          workspaceId: flag("workspace") ?? "",
          elementId: flag("element") ?? "",
          documentName: flag("name") ?? "",
        }),
      );
      return;
    }
    if (subcommand === "describe") {
      printJson(await callClaudeCadTool("onshape_describe"));
      return;
    }
    if (subcommand === "sketch") {
      printJson(
        await callClaudeCadTool("onshape_sketch_rectangle", {
          widthMm: numFlag("width", 40),
          heightMm: numFlag("height", 40),
          plane: flag("plane") ?? "Top",
          name: flag("name") ?? "VantageSketch",
        }),
      );
      return;
    }
    if (subcommand === "extrude") {
      printJson(
        await callClaudeCadTool("onshape_extrude", {
          depthMm: numFlag("depth", 10),
          sketchFeatureId: flag("sketch") ?? "",
        }),
      );
      return;
    }
    console.log("vantage-cad onshape <docs|elements|bind|describe|sketch|extrude>");
    console.log("  docs");
    console.log("  elements --document ID --workspace ID");
    console.log("  bind --document ID --workspace ID --element ID");
    console.log("  sketch --width 40 --height 20 [--plane Top]");
    console.log("  extrude --depth 10");
    return;
  }
  if (command === "fusion") {
    if (subcommand === "ping" || subcommand === "status") {
      printJson(await callClaudeCadTool("fusion_status"));
      return;
    }
    if (subcommand === "describe") {
      printJson(await callClaudeCadTool("fusion_describe"));
      return;
    }
    if (subcommand === "sketch") {
      printJson(
        await callClaudeCadTool("fusion_sketch_rectangle", {
          widthMm: numFlag("width", 40),
          heightMm: numFlag("height", 40),
          name: flag("name") ?? "VantageSketch",
        }),
      );
      return;
    }
    if (subcommand === "extrude") {
      printJson(await callClaudeCadTool("fusion_extrude", { depthMm: numFlag("depth", 10) }));
      return;
    }
    console.log("vantage-cad fusion <ping|describe|sketch|extrude>");
    console.log("  ping                 Fusion add-in health on 127.0.0.1:32145");
    console.log("  sketch --width 40 --height 20");
    console.log("  extrude --depth 10");
    return;
  }
  throw new Error(`Unknown CAD command ${command}`);
}
