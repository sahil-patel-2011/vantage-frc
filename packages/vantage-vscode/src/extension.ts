import * as vscode from "vscode";
import { revokeSession, submitContext } from "./api";
import { getBaseUrl } from "./config";
import { buildFileReviewContext, buildSelectionContext, formatContextPreview } from "./context";
import { runPairFlow } from "./pair";
import { clearSession, loadSession, saveSession } from "./session";
import { StatusBar } from "./status";
import type { EditorContextPayload, EditorSession } from "./types";

let statusBar: StatusBar;
let currentSession: EditorSession | undefined;

async function refreshSession(context: vscode.ExtensionContext) {
  currentSession = await loadSession(context.secrets);
  statusBar.update(currentSession);
}

async function ensureSession(context: vscode.ExtensionContext): Promise<EditorSession | undefined> {
  if (currentSession) return currentSession;
  const existing = await loadSession(context.secrets);
  if (existing) {
    currentSession = existing;
    statusBar.update(currentSession);
    return currentSession;
  }
  const paired = await runPairFlow(context.secrets);
  currentSession = paired;
  statusBar.update(currentSession);
  return currentSession;
}

async function confirmAndShare(
  context: vscode.ExtensionContext,
  payload: EditorContextPayload,
): Promise<void> {
  const session = await ensureSession(context);
  if (!session) return;

  const preview = formatContextPreview(payload);
  const doc = await vscode.workspace.openTextDocument({ content: preview, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });

  const choice = await vscode.window.showWarningMessage(
    "Share this context with Vantage? Only the previewed fields are sent — never the whole repo.",
    { modal: true },
    "Share with Vantage",
    "Cancel",
  );
  if (choice !== "Share with Vantage") return;

  try {
    const result = await submitContext(session, payload);
    const openChat = "Open Chat";
    const openCode = "Open Code";
    const next = await vscode.window.showInformationMessage(
      `Shared ${result.summary.contentChars} chars` +
        (result.summary.relativePath ? ` from ${result.summary.relativePath}` : "") +
        `. Context id ${result.contextId.slice(0, 8)}…`,
      openChat,
      openCode,
    );
    if (next === openChat) await vscode.env.openExternal(vscode.Uri.parse(result.deepLinks.chat));
    if (next === openCode) await vscode.env.openExternal(vscode.Uri.parse(result.deepLinks.code));
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Share failed");
  }
}

export async function activate(context: vscode.ExtensionContext) {
  statusBar = new StatusBar();
  await refreshSession(context);

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("vantage.signIn", async () => {
      const session = await runPairFlow(context.secrets);
      if (session) {
        currentSession = session;
        statusBar.update(currentSession);
      }
    }),
    vscode.commands.registerCommand("vantage.signOut", async () => {
      if (currentSession && !currentSession.mock) {
        try {
          await revokeSession(currentSession.deviceToken);
        } catch {
          // Local clear still proceeds if revoke fails (offline / already revoked).
        }
      }
      await clearSession(context.secrets);
      currentSession = undefined;
      statusBar.update(undefined);
      void vscode.window.showInformationMessage("Signed out of Vantage.");
    }),
    vscode.commands.registerCommand("vantage.selectOrg", async () => {
      const session = await ensureSession(context);
      if (!session) return;
      const rePair = "Re-pair / switch org";
      const pick = await vscode.window.showInformationMessage(
        `Connected organization: ${session.orgName}\nOrg id: ${session.orgId}` +
          (session.mock ? "\n(mock session)" : ""),
        rePair,
      );
      if (pick === rePair) {
        await vscode.commands.executeCommand("vantage.signOut");
        await vscode.commands.executeCommand("vantage.signIn");
      }
    }),
    vscode.commands.registerCommand("vantage.askSelection", async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: "What should Vantage help with about this selection?",
        placeHolder: "Why is this command starving the robot thread?",
      });
      if (prompt === undefined) return;
      const payload = await buildSelectionContext(prompt || undefined);
      if (payload) await confirmAndShare(context, payload);
    }),
    vscode.commands.registerCommand("vantage.reviewFile", async () => {
      const payload = await buildFileReviewContext();
      if (payload) await confirmAndShare(context, payload);
    }),
    vscode.commands.registerCommand("vantage.openChat", async () => {
      const session = await ensureSession(context);
      if (!session) return;
      const url = `${session.vantageUrl.replace(/\/+$/, "")}/chat?orgId=${encodeURIComponent(session.orgId)}&source=vscode`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand("vantage.openCode", async () => {
      const session = await ensureSession(context);
      if (!session) return;
      const url = `${session.vantageUrl.replace(/\/+$/, "")}/code?orgId=${encodeURIComponent(session.orgId)}&source=vscode`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand("vantage.showPrivacy", async () => {
      const md = [
        "# Vantage editor privacy",
        "",
        "- Pairing binds this machine to one organization you approve in the browser.",
        "- Context is **never** uploaded until you confirm a share preview.",
        "- Only the open file, selection, language, optional diagnostics, and your prompt are eligible.",
        "- Whole-repository upload is not supported and will never run silently.",
        `- Current base URL: ${getBaseUrl()}`,
        `- Connected: ${currentSession ? currentSession.orgName : "no"}`,
      ].join("\n");
      const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("vantage.baseUrl") && currentSession) {
        currentSession = { ...currentSession, vantageUrl: getBaseUrl() };
        await saveSession(context.secrets, currentSession);
      }
    }),
  );
}

export function deactivate() {
  // disposables cleaned via subscriptions
}
