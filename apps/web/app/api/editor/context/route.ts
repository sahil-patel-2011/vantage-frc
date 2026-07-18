import { getEditorRelayPool } from "@vantage/db/editor-relay";
import { requireEditorDevice } from "../../../../lib/editor/device-auth";

const MAX_CONTENT_CHARS = 48_000;
const MAX_DIAGNOSTICS = 40;

type ContextBody = {
  intent?: "ask_selection" | "review_file" | "share_context";
  optIn?: boolean;
  workspaceRoot?: string;
  relativePath?: string;
  languageId?: string;
  selection?: { startLine?: number; endLine?: number; text?: string };
  fileContent?: string;
  diagnostics?: Array<{ severity?: string; message?: string; line?: number }>;
  prompt?: string;
};

/**
 * Opt-in editor context upload from the VS Code extension.
 * Never accepts a whole-repo archive — only the explicit payload the user approved.
 */
export async function POST(request: Request) {
  const device = await requireEditorDevice(request);
  if (device instanceof Response) return device;

  if (!device.scopes.includes("editor.context.submit")) {
    return Response.json({ error: "Device lacks editor.context.submit scope" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as ContextBody;
    if (body.optIn !== true) {
      return Response.json(
        { error: "optIn must be true — context is never accepted without explicit user consent" },
        { status: 400 },
      );
    }

    const intent = body.intent ?? "share_context";
    if (!["ask_selection", "review_file", "share_context"].includes(intent)) {
      throw new Error("Unsupported intent");
    }

    const selectionText = typeof body.selection?.text === "string" ? body.selection.text.slice(0, MAX_CONTENT_CHARS) : "";
    const fileContent = typeof body.fileContent === "string" ? body.fileContent.slice(0, MAX_CONTENT_CHARS) : "";
    const contentChars = selectionText.length + fileContent.length;
    if (contentChars > MAX_CONTENT_CHARS) {
      throw new Error(`Context exceeds ${MAX_CONTENT_CHARS} character limit`);
    }

    const diagnostics = (Array.isArray(body.diagnostics) ? body.diagnostics : [])
      .slice(0, MAX_DIAGNOSTICS)
      .map((d) => ({
        severity: String(d.severity ?? "info").slice(0, 32),
        message: String(d.message ?? "").slice(0, 500),
        line: typeof d.line === "number" ? d.line : undefined,
      }));

    const payload = {
      intent,
      workspaceRoot: typeof body.workspaceRoot === "string" ? body.workspaceRoot.slice(0, 500) : null,
      relativePath: typeof body.relativePath === "string" ? body.relativePath.slice(0, 500) : null,
      languageId: typeof body.languageId === "string" ? body.languageId.slice(0, 64) : null,
      selection: body.selection
        ? {
            startLine: body.selection.startLine ?? null,
            endLine: body.selection.endLine ?? null,
            text: selectionText,
          }
        : null,
      fileContent: fileContent || null,
      diagnostics,
      prompt: typeof body.prompt === "string" ? body.prompt.slice(0, 4000) : null,
      submittedAt: new Date().toISOString(),
    };

    const inserted = await getEditorRelayPool().query<{ id: string }>(
      `INSERT INTO editor_context_submissions(
         org_id, user_id, device_id, intent, relative_path, language_id,
         selection_lines, content_chars, diagnostics_count, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id`,
      [
        device.orgId,
        device.userId,
        device.id,
        intent,
        payload.relativePath,
        payload.languageId,
        payload.selection?.startLine != null && payload.selection?.endLine != null
          ? Math.max(0, Number(payload.selection.endLine) - Number(payload.selection.startLine) + 1)
          : null,
        contentChars,
        diagnostics.length,
        JSON.stringify(payload),
      ],
    );

    const base = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    const chatUrl = new URL("/chat", base);
    chatUrl.searchParams.set("orgId", device.orgId);
    chatUrl.searchParams.set("source", "vscode");
    chatUrl.searchParams.set("contextId", inserted.rows[0]!.id);
    if (payload.prompt) chatUrl.searchParams.set("prompt", payload.prompt.slice(0, 500));

    const codeUrl = new URL("/code", base);
    codeUrl.searchParams.set("orgId", device.orgId);
    codeUrl.searchParams.set("source", "vscode");
    if (payload.relativePath) codeUrl.searchParams.set("file", payload.relativePath);

    return Response.json({
      success: true,
      contextId: inserted.rows[0]!.id,
      summary: {
        intent,
        relativePath: payload.relativePath,
        languageId: payload.languageId,
        contentChars,
        diagnosticsCount: diagnostics.length,
        selectionLines: payload.selection?.startLine != null ? payload.selection : null,
      },
      deepLinks: {
        chat: chatUrl.toString(),
        code: codeUrl.toString(),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Context submit failed" },
      { status: 400 },
    );
  }
}
