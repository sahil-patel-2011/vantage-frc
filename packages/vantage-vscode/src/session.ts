import * as vscode from "vscode";
import type { EditorSession } from "./types";

const SESSION_KEY = "vantage.editorSession";

export async function loadSession(secrets: vscode.SecretStorage): Promise<EditorSession | undefined> {
  const raw = await secrets.get(SESSION_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as EditorSession;
  } catch {
    return undefined;
  }
}

export async function saveSession(secrets: vscode.SecretStorage, session: EditorSession): Promise<void> {
  await secrets.store(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SESSION_KEY);
}
