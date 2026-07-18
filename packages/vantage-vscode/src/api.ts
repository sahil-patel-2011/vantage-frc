import { getBaseUrl } from "./config";
import type {
  ContextSubmitResponse,
  EditorContextPayload,
  EditorSession,
  PairPollResponse,
  PairStartResponse,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function startPairing(input: {
  machineName: string;
  extensionVersion: string;
  platform: string;
}): Promise<PairStartResponse> {
  const response = await fetch(`${getBaseUrl()}/api/editor/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, editor: "vscode" }),
  });
  return parseJson<PairStartResponse>(response);
}

export async function pollPairing(pollToken: string): Promise<PairPollResponse> {
  const response = await fetch(`${getBaseUrl()}/api/editor/pair/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pollToken }),
  });
  if (response.status === 410) {
    const data = (await response.json()) as PairPollResponse;
    return data;
  }
  return parseJson<PairPollResponse>(response);
}

export async function fetchSession(deviceToken: string): Promise<{
  deviceId: string;
  userId: string;
  orgId: string;
  orgName: string;
  scopes: string[];
}> {
  const response = await fetch(`${getBaseUrl()}/api/editor/session`, {
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  return parseJson(response);
}

export async function revokeSession(deviceToken: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/api/editor/session`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  if (!response.ok && response.status !== 401) {
    await parseJson(response);
  }
}

export async function submitContext(
  session: EditorSession,
  payload: EditorContextPayload,
): Promise<ContextSubmitResponse> {
  if (session.mock) {
    const base = session.vantageUrl.replace(/\/+$/, "");
    return {
      success: true,
      contextId: `mock-${Date.now()}`,
      summary: {
        intent: payload.intent,
        relativePath: payload.relativePath ?? null,
        languageId: payload.languageId ?? null,
        contentChars: (payload.selection?.text?.length ?? 0) + (payload.fileContent?.length ?? 0),
        diagnosticsCount: payload.diagnostics?.length ?? 0,
      },
      deepLinks: {
        chat: `${base}/chat?orgId=${encodeURIComponent(session.orgId)}&source=vscode&prompt=${encodeURIComponent(payload.prompt ?? "")}`,
        code: `${base}/code?orgId=${encodeURIComponent(session.orgId)}&source=vscode`,
      },
    };
  }

  const response = await fetch(`${getBaseUrl()}/api/editor/context`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.deviceToken}`,
    },
    body: JSON.stringify(payload),
  });
  return parseJson<ContextSubmitResponse>(response);
}
