import type { PoolClient } from "@neondatabase/serverless";
import type { CadAgentStep, ClaudeCadSession } from "@vantage/cad";
import { onshapeDocumentOpenUrl, parseCadAgentSteps } from "@vantage/cad";

export const CAD_AGENT_JOB_TITLE = "CAD agent";

export type CadAgentChatMessage = {
  role: "user" | "assistant" | "tool";
  text: string;
};

export type CadAgentSessionRow = {
  jobId: string;
  session: ClaudeCadSession;
  url: string;
  messages: CadAgentChatMessage[];
  /** Narrated build steps rendered by the /cad session pane. */
  steps: CadAgentStep[];
};

type DocumentRef = Record<string, unknown>;

function asSession(ref: DocumentRef | null | undefined): ClaudeCadSession {
  if (!ref) return {};
  const documentId = typeof ref.documentId === "string" ? ref.documentId : "";
  const workspaceId = typeof ref.workspaceId === "string" ? ref.workspaceId : "";
  const elementId = typeof ref.elementId === "string" ? ref.elementId : "";
  return {
    documentId: documentId || undefined,
    workspaceId: workspaceId || undefined,
    elementId: elementId || undefined,
    documentName: typeof ref.documentName === "string" ? ref.documentName : undefined,
    elementName: typeof ref.elementName === "string" ? ref.elementName : undefined,
    lastSketchFeatureId: typeof ref.lastSketchFeatureId === "string" ? ref.lastSketchFeatureId : undefined,
    // Feature history persists so plan steps and undo can chain across requests.
    features: Array.isArray(ref.features) ? (ref.features as ClaudeCadSession["features"]) : undefined,
    rebuild: typeof ref.rebuild === "number" ? ref.rebuild : undefined,
  };
}

function asMessages(brief: unknown): CadAgentChatMessage[] {
  if (!brief || typeof brief !== "object") return [];
  const raw = (brief as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is CadAgentChatMessage => {
      if (!row || typeof row !== "object") return false;
      const role = (row as CadAgentChatMessage).role;
      const text = (row as CadAgentChatMessage).text;
      return (role === "user" || role === "assistant" || role === "tool") && typeof text === "string";
    })
    .slice(-24);
}

export function cadAgentOpenUrl(session: ClaudeCadSession): string | null {
  if (!session.documentId) return null;
  return onshapeDocumentOpenUrl({
    documentId: session.documentId,
    workspaceId: session.workspaceId,
    elementId: session.elementId,
  });
}

export async function loadCadAgentSession(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<CadAgentSessionRow | null> {
  const row = (
    await client.query<{ id: string; document_ref: DocumentRef | null; brief: unknown }>(
      `SELECT id, document_ref, brief FROM cad_jobs
       WHERE org_id=$1::uuid AND created_by=$2::uuid AND title=$3
       ORDER BY updated_at DESC LIMIT 1`,
      [orgId, userId, CAD_AGENT_JOB_TITLE],
    )
  ).rows[0];
  if (!row) return null;
  const session = asSession(row.document_ref);
  return {
    jobId: row.id,
    session,
    url: typeof row.document_ref?.url === "string" ? row.document_ref.url : cadAgentOpenUrl(session) ?? "",
    messages: asMessages(row.brief),
    steps: parseCadAgentSteps((row.brief as { steps?: unknown } | null)?.steps),
  };
}

export async function saveCadAgentSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    connectionId: string | null;
    session: ClaudeCadSession;
    url?: string;
    messages?: CadAgentChatMessage[];
    steps?: CadAgentStep[];
  },
): Promise<CadAgentSessionRow> {
  const existing = await loadCadAgentSession(client, input.orgId, input.userId);
  const url =
    input.url ||
    cadAgentOpenUrl(input.session) ||
    existing?.url ||
    "";
  const messages = input.messages ?? existing?.messages ?? [];
  // Steps live beside the transcript so a page reload re-renders the same build log.
  const steps = parseCadAgentSteps(input.steps ?? existing?.steps ?? []);
  const documentRef = {
    documentId: input.session.documentId ?? null,
    workspaceId: input.session.workspaceId ?? null,
    elementId: input.session.elementId ?? null,
    documentName: input.session.documentName ?? null,
    elementName: input.session.elementName ?? null,
    lastSketchFeatureId: input.session.lastSketchFeatureId ?? null,
    features: (input.session.features ?? []).slice(-200),
    rebuild: input.session.rebuild ?? 0,
    url,
  };
  const brief = { kind: "cad_agent", messages, steps };

  if (existing) {
    await client.query(
      `UPDATE cad_jobs
       SET document_ref=$3::jsonb, brief=$4::jsonb, connection_id=$5::uuid, platform='onshape',
           execution_mode='hosted', status='running', updated_at=now()
       WHERE id=$1::uuid AND org_id=$2::uuid`,
      [existing.jobId, input.orgId, JSON.stringify(documentRef), JSON.stringify(brief), input.connectionId],
    );
    return { jobId: existing.jobId, session: input.session, url, messages, steps };
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO cad_jobs (
       org_id, created_by, connection_id, execution_mode, platform, title, status, brief, document_ref
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'hosted', 'onshape', $4, 'running', $5::jsonb, $6::jsonb
     ) RETURNING id`,
    [
      input.orgId,
      input.userId,
      input.connectionId,
      CAD_AGENT_JOB_TITLE,
      JSON.stringify(brief),
      JSON.stringify(documentRef),
    ],
  );
  return { jobId: inserted.rows[0]!.id, session: input.session, url, messages, steps };
}
