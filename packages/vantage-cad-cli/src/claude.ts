import {
  CLAUDE_CAD_INSTRUCTIONS,
  callClaudeCadTool,
  type ClaudeCadRuntime,
} from "@vantage/cad";

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

function optionalNumFlag(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

export async function runClaudeCadCli(
  command: string,
  subcommand = "",
  report?: CadToolReport,
  runtime: ClaudeCadRuntime = {},
) {
  /** Run one CAD tool, print its result, and report it for web sync (never blocking on sync). */
  async function run(tool: string, args: Record<string, unknown> = {}) {
    try {
      const result = await callClaudeCadTool(tool, args, runtime);
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
    if (subcommand === "create-part-studio") {
      await run("onshape_create_part_studio", {
        documentId: flag("document") ?? "",
        workspaceId: flag("workspace") ?? "",
        name: flag("name") ?? "",
      });
      return;
    }
    if (subcommand === "body-details") {
      await run("onshape_body_details");
      return;
    }
    if (subcommand === "create-assembly") {
      await run("onshape_create_assembly", {
        documentId: flag("document") ?? "",
        workspaceId: flag("workspace") ?? "",
        name: flag("name") ?? "",
      });
      return;
    }
    if (subcommand === "add-instance") {
      await run("onshape_add_assembly_instance", {
        assemblyElementId: flag("assembly") ?? "",
        sourceDocumentId: flag("source-document") ?? "",
        sourceElementId: flag("source-element") ?? "",
        partId: flag("part") ?? "",
        isAssembly: process.argv.includes("--is-assembly"),
      });
      return;
    }
    if (subcommand === "mate") {
      await run("onshape_mate", {
        assemblyElementId: flag("assembly") ?? "",
        name: flag("name") ?? "",
        mateType: flag("type") ?? "FASTENED",
        firstInstanceId: flag("first-instance") ?? "",
        secondInstanceId: flag("second-instance") ?? "",
        firstFaceId: flag("first-face") ?? "",
        secondFaceId: flag("second-face") ?? "",
        firstFlipPrimary: process.argv.includes("--first-flip"),
        secondFlipPrimary: process.argv.includes("--second-flip"),
        firstOffsetXMm: numFlag("first-x", 0),
        firstOffsetYMm: numFlag("first-y", 0),
        firstOffsetZMm: numFlag("first-z", 0),
        secondOffsetXMm: numFlag("second-x", 0),
        secondOffsetYMm: numFlag("second-y", 0),
        secondOffsetZMm: numFlag("second-z", 0),
        minLimit: optionalNumFlag("min"),
        maxLimit: optionalNumFlag("max"),
      });
      return;
    }
    if (subcommand === "assembly") {
      await run("onshape_get_assembly", {
        assemblyElementId: flag("assembly") ?? "",
      });
      return;
    }
    console.log("vantage-cad onshape <docs|elements|bind|describe|sketch|extrude|create-part-studio|body-details|create-assembly|add-instance|mate|assembly>");
    console.log("  docs");
    console.log("  elements --document ID --workspace ID");
    console.log("  bind --document ID --workspace ID --element ID");
    console.log("  sketch --width 40 --height 20 [--plane Top]");
    console.log("  extrude --depth 10");
    console.log("  create-part-studio --name \"Mechanism parts\" [--document ID --workspace ID]");
    console.log("  body-details");
    console.log("  create-assembly --name Drivebase");
    console.log("  add-instance --assembly ID --source-element ID [--part ID|--is-assembly]");
    console.log("  mate --assembly ID --type FASTENED --first-instance ID --first-face ID --second-instance ID --second-face ID");
    console.log("  assembly --assembly ID");
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
