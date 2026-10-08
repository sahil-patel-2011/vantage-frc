export type CadDesktopStatus = {
  phase: "setup_required" | "idle" | "starting" | "browser_open" | "stopping" | "error";
  message: string;
  orgId?: string;
};

export type CadDesktopStart = { orgId: string; url?: string };
export type CadDesktopTool = {
  name: "observe" | "bind" | "action" | "capabilities";
  arguments?: Record<string, unknown>;
};

export function parseCadDesktopStart(value: unknown): Required<CadDesktopStart> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a team to open CAD.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["orgId", "url"].includes(key)) || typeof input.orgId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.orgId)) throw new Error("Choose a valid team.");
  if (input.url !== undefined && typeof input.url !== "string") throw new Error("Choose an Onshape workspace URL.");
  const url = new URL(input.url as string | undefined ?? "https://cad.onshape.com/documents");
  if (url.origin !== "https://cad.onshape.com" || url.username || url.password ||
    !/^\/documents(?:\/[a-f0-9]{24}\/w\/[a-f0-9]{24}(?:\/e\/[a-f0-9]{24})?)?\/?$/i.test(url.pathname)) {
    throw new Error("Choose an Onshape Documents page or editable workspace URL.");
  }
  return { orgId: input.orgId, url: url.href };
}

export function parseCadDesktopTool(value: unknown): CadDesktopTool {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a supported CAD tool.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["name", "arguments"].includes(key)) ||
    !["observe", "bind", "action", "capabilities"].includes(String(input.name)) ||
    (input.arguments !== undefined && (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)))) {
    throw new Error("Choose a supported CAD tool and arguments.");
  }
  if (JSON.stringify(input).length > 65_536) throw new Error("CAD tool input is too large.");
  return structuredClone(input) as CadDesktopTool;
}

export function cadSenderIsTrusted(input: { frameUrl: string; mainFrame: boolean; appOrigin: string }): boolean {
  try {
    const url = new URL(input.frameUrl);
    return input.mainFrame && url.origin === input.appOrigin && input.appOrigin.startsWith("https://") &&
      url.pathname.replace(/\/$/, "") === "/cad/browser-agent";
  }
  catch { return false; }
}
