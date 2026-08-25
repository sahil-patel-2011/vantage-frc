import { CLAUDE_CAD_INSTRUCTIONS, callClaudeCadTool } from "@vantage/cad";

/** Fire-and-forget report of one tool call to the hosted app (see src/sync.ts). */
export type CadToolReport = (
  tool: string,
  args: Record<string, unknown>,
  ok: boolean,
  error?: string,
) => Promise<void>;

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

export async function runClaudeCadCli(command: string, subcommand = "", report?: CadToolReport) {
  /** Run one CAD tool, print its result, and report it for web sync (never blocking on sync). */
  async function run(tool: string, args: Record<string, unknown> = {}) {
    try {
      const result = await callClaudeCadTool(tool, args);
      await report?.(tool, args, true).catch(() => undefined);
      printJson(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CAD tool failed";
      await report?.(tool, args, false, message).catch(() => undefined);
      throw error;
    }
  }

  if (command === "claude") {
    console.log(CLAUDE_CAD_INSTRUCTIONS);
    await run("cad_status");
    return;
  }
  if (command === "onshape") {
    if (subcommand === "docs" || subcommand === "documents") {
      await run("onshape_list_documents", { limit: numFlag("limit", 12) });
      return;
    }
    if (subcommand === "elements") {
      await run("onshape_list_elements", {
        documentId: flag("document") ?? "",
        workspaceId: flag("workspace") ?? "",
      });
      return;
    }
    if (subcommand === "bind") {
      await run("onshape_bind", {
        documentId: flag("document") ?? "",
        workspaceId: flag("workspace") ?? "",
        elementId: flag("element") ?? "",
        documentName: flag("name") ?? "",
      });
      return;
    }
    if (subcommand === "describe") {
      await run("onshape_describe");
      return;
    }
    if (subcommand === "sketch") {
      await run("onshape_sketch_rectangle", {
        widthMm: numFlag("width", 40),
        heightMm: numFlag("height", 40),
        plane: flag("plane") ?? "Top",
        name: flag("name") ?? "VantageSketch",
      });
      return;
    }
    if (subcommand === "extrude") {
      await run("onshape_extrude", {
        depthMm: numFlag("depth", 10),
        sketchFeatureId: flag("sketch") ?? "",
      });
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
      await run("fusion_status");
      return;
    }
    if (subcommand === "describe") {
      await run("fusion_describe");
      return;
    }
    if (subcommand === "sketch") {
      await run("fusion_sketch_rectangle", {
        widthMm: numFlag("width", 40),
        heightMm: numFlag("height", 40),
        name: flag("name") ?? "VantageSketch",
      });
      return;
    }
    if (subcommand === "extrude") {
      await run("fusion_extrude", { depthMm: numFlag("depth", 10) });
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
