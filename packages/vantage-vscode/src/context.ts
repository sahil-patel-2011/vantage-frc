import * as path from "node:path";
import * as vscode from "vscode";
import { includeDiagnosticsDefault, maxContentChars } from "./config";
import type { EditorContextPayload } from "./types";

function workspaceRootFor(uri: vscode.Uri | undefined): string | undefined {
  if (!uri) return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function relativePath(root: string | undefined, filePath: string): string {
  if (!root) return filePath;
  const rel = path.relative(root, filePath);
  return rel && !rel.startsWith("..") ? rel.replace(/\\/g, "/") : path.basename(filePath);
}

async function collectDiagnostics(uri: vscode.Uri): Promise<EditorContextPayload["diagnostics"]> {
  if (!includeDiagnosticsDefault()) return [];
  return vscode.languages.getDiagnostics(uri).slice(0, 40).map((d) => ({
    severity: vscode.DiagnosticSeverity[d.severity] ?? "Information",
    message: d.message.slice(0, 500),
    line: d.range.start.line + 1,
  }));
}

export async function buildSelectionContext(prompt?: string): Promise<EditorContextPayload | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open a file and select code first.");
    return undefined;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    void vscode.window.showWarningMessage("Select the code you want to ask about.");
    return undefined;
  }

  const text = editor.document.getText(selection).slice(0, maxContentChars());
  const root = workspaceRootFor(editor.document.uri);
  const diagnostics = await collectDiagnostics(editor.document.uri);

  return {
    intent: "ask_selection",
    optIn: true,
    workspaceRoot: root,
    relativePath: relativePath(root, editor.document.uri.fsPath),
    languageId: editor.document.languageId,
    selection: {
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
      text,
    },
    diagnostics,
    prompt,
  };
}

export async function buildFileReviewContext(prompt?: string): Promise<EditorContextPayload | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open a file to review.");
    return undefined;
  }

  const text = editor.document.getText().slice(0, maxContentChars());
  const root = workspaceRootFor(editor.document.uri);
  const diagnostics = await collectDiagnostics(editor.document.uri);

  return {
    intent: "review_file",
    optIn: true,
    workspaceRoot: root,
    relativePath: relativePath(root, editor.document.uri.fsPath),
    languageId: editor.document.languageId,
    fileContent: text,
    diagnostics,
    prompt: prompt ?? "Review this robot code file for bugs, WPILib pitfalls, and safer alternatives.",
  };
}

/** Human-readable preview of what will be sent — never silent upload. */
export function formatContextPreview(payload: EditorContextPayload): string {
  const lines = [
    `Intent: ${payload.intent}`,
    `Workspace root: ${payload.workspaceRoot ?? "(none)"}`,
    `File: ${payload.relativePath ?? "(none)"}`,
    `Language: ${payload.languageId ?? "(unknown)"}`,
  ];

  if (payload.selection) {
    lines.push(
      `Selection: lines ${payload.selection.startLine}–${payload.selection.endLine} (${payload.selection.text.length} chars)`,
    );
  }
  if (payload.fileContent) {
    lines.push(`File content: ${payload.fileContent.length} chars (capped; not the whole repo)`);
  }
  lines.push(`Diagnostics: ${payload.diagnostics?.length ?? 0}`);
  if (payload.prompt) lines.push(`Prompt: ${payload.prompt}`);
  lines.push("");
  lines.push("Nothing else from your workspace is included. Whole-repo upload is never performed.");
  return lines.join("\n");
}
