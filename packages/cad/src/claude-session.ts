import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ClaudeCadSession = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  lastSketchFeatureId?: string;
  documentName?: string;
};

const sessionPath = () => join(homedir(), ".vantage-cad", "claude-session.json");

export async function loadClaudeCadSession(): Promise<ClaudeCadSession> {
  try {
    const raw = await readFile(sessionPath(), "utf8");
    return JSON.parse(raw) as ClaudeCadSession;
  } catch {
    return {};
  }
}

export async function saveClaudeCadSession(next: ClaudeCadSession): Promise<void> {
  const dir = join(homedir(), ".vantage-cad");
  await mkdir(dir, { recursive: true });
  const path = sessionPath();
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export function requireBoundDocument(session: ClaudeCadSession) {
  if (!session.documentId || !session.workspaceId || !session.elementId) {
    throw new Error(
      "No Part Studio bound. Call onshape_list_documents, then onshape_bind with documentId, workspaceId, and elementId from a disposable document.",
    );
  }
  return {
    documentId: session.documentId,
    workspaceId: session.workspaceId,
    elementId: session.elementId,
  };
}
