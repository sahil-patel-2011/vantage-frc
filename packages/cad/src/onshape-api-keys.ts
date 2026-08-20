/**
 * Onshape API-key client for Claude Code / vantage-cad in the terminal.
 * Uses HTTP Basic (access key + secret key) — the same method as Onshape's
 * documented API keys. Never log the secret.
 */

export const ONSHAPE_CAD_HOST = "https://cad.onshape.com";

export type OnshapeApiKeyCredentials = {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
};

export function readOnshapeApiKeys(env: NodeJS.ProcessEnv = process.env): OnshapeApiKeyCredentials | null {
  const accessKey = (env.ONSHAPE_ACCESS_KEY ?? env.ONSHAPE_API_KEY ?? "").trim();
  const secretKey = (env.ONSHAPE_SECRET_KEY ?? env.ONSHAPE_API_SECRET ?? "").trim();
  if (!accessKey || !secretKey) return null;
  const baseUrl = (env.ONSHAPE_BASE_URL ?? ONSHAPE_CAD_HOST).replace(/\/$/, "");
  return { accessKey, secretKey, baseUrl };
}

export function onshapeApiKeysStatus(env: NodeJS.ProcessEnv = process.env) {
  const creds = readOnshapeApiKeys(env);
  return {
    configured: Boolean(creds),
    setupRequired: !creds,
    message: creds
      ? "Onshape API keys are set in this terminal."
      : "Setup required — create a key pair at https://dev-portal.onshape.com/keys then set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY.",
  };
}

export function onshapeBasicAuthorization(accessKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${accessKey}:${secretKey}`, "utf8").toString("base64")}`;
}

export type OnshapeKeyHttp = (path: string, init?: RequestInit) => Promise<Response>;

export function createOnshapeApiKeyHttp(creds: OnshapeApiKeyCredentials): OnshapeKeyHttp {
  const auth = onshapeBasicAuthorization(creds.accessKey, creds.secretKey);
  return (path, init = {}) => {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = suffix.startsWith("/api/") ? `${creds.baseUrl}${suffix}` : `${creds.baseUrl}/api/v6${suffix}`;
    return fetch(url, {
      ...init,
      headers: {
        accept: "application/json;charset=UTF-8; qs=0.09",
        authorization: auth,
        ...(init.body ? { "content-type": "application/json;charset=UTF-8; qs=0.09" } : {}),
        ...init.headers,
      },
    });
  };
}

export async function readOnshapeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Onshape returned non-JSON (${response.status}): ${text.slice(0, 240)}`);
  }
}

export function onshapeHttpError(status: number, body: unknown): Error {
  const raw = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const safe = raw.replace(/Basic [A-Za-z0-9+/=]+/g, "Basic ***");
  return new Error(`Onshape HTTP ${status}: ${safe.slice(0, 400)}`);
}
