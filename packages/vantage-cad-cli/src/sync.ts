/**
 * Terminal → web sync for vantage-cad.
 *
 * After a mutating CAD tool call (sketch/extrude/bind) and at session start/end,
 * the CLI posts a compact record to the hosted app (POST /api/cad/sync) using the
 * SAME paired device token the relay routes already use — no second auth path.
 * The server writes it into cad_jobs via the record_cad_cli_session SECURITY
 * DEFINER function (migration 0451), so the /cad page shows terminal work next
 * to web agent sessions.
 *
 * Sync is a bonus, never a blocker: with no pairing or no network the CLI says
 * so ONCE (on stderr — stdout may carry the MCP protocol) and keeps working
 * locally. Failed posts are queued (bounded) in the CLI's existing config dir
 * and retried on the next CAD command.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadClaudeCadSession, type ClaudeCadSession } from "@vantage/cad";
import { loadDeviceCredential } from "./secure-store";

/** Tool calls that change (or re-target) a CAD document — the only ones worth syncing per-call. */
export const MUTATING_CAD_TOOLS = new Set([
  "onshape_bind",
  "onshape_sketch_rectangle",
  "onshape_extrude",
  "fusion_sketch_rectangle",
  "fusion_extrude",
]);

export const SYNC_QUEUE_LIMIT = 50;
/** One rolling terminal "session" groups commands from the same sitting (6 h). */
export const SYNC_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const POST_TIMEOUT_MS = 5_000;
const MAX_EVENT_PARAMS = 12;

export type CadSyncEvent = {
  tool: string;
  params: Record<string, string | number | boolean>;
  at: string;
  ok: boolean;
  error?: string;
};

export type CadSyncPayload = {
  sessionId: string;
  platform: "onshape" | "fusion360" | null;
  documentRef: Record<string, string> | null;
  event: CadSyncEvent | null;
  status: "running" | "completed" | "failed";
};

export type CadSyncState = {
  sessionId: string;
  sessionStartedAt: string;
  lastSyncedAt: string | null;
  queue: CadSyncPayload[];
};

export function newCadSyncSessionId(): string {
  return `t_${randomBytes(12).toString("base64url")}`;
}

/** Reuse the rolling session while it is fresh; otherwise rotate to a new one. */
export function ensureFreshSyncSession(state: CadSyncState | null, nowMs: number): CadSyncState {
  if (state?.sessionId && /^[A-Za-z0-9_-]{8,64}$/.test(state.sessionId)) {
    const startedAt = Date.parse(state.sessionStartedAt);
    if (Number.isFinite(startedAt) && nowMs - startedAt < SYNC_SESSION_MAX_AGE_MS) {
      return { ...state, queue: Array.isArray(state.queue) ? state.queue : [] };
    }
  }
  return {
    sessionId: newCadSyncSessionId(),
    sessionStartedAt: new Date(nowMs).toISOString(),
    lastSyncedAt: state?.lastSyncedAt ?? null,
    queue: state?.queue && Array.isArray(state.queue) ? state.queue : [],
  };
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Primitive params only, secret-shaped keys dropped, strings clipped — mirrors the server validator. */
export function summarizeCadSyncParams(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_EVENT_PARAMS) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    if (/key|secret|token|password|credential|authorization/i.test(key)) continue;
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") out[key] = clip(value, 80);
  }
  return out;
}

export function cadToolPlatform(tool: string): "onshape" | "fusion360" | null {
  if (tool.startsWith("onshape_")) return "onshape";
  if (tool.startsWith("fusion_")) return "fusion360";
  return null;
}

export function documentRefFromBoundSession(session: ClaudeCadSession): Record<string, string> | null {
  const ref: Record<string, string> = {};
  if (session.documentId) ref.documentId = clip(session.documentId, 200);
  if (session.workspaceId) ref.workspaceId = clip(session.workspaceId, 200);
  if (session.elementId) ref.elementId = clip(session.elementId, 200);
  if (session.documentName) ref.documentName = clip(session.documentName, 200);
  return Object.keys(ref).length ? ref : null;
}

export function enqueueBounded(queue: CadSyncPayload[], payload: CadSyncPayload): CadSyncPayload[] {
  const next = [...queue, payload];
  return next.length > SYNC_QUEUE_LIMIT ? next.slice(next.length - SYNC_QUEUE_LIMIT) : next;
}

/** Doctor-style status lines for `vantage-cad status`. */
export function formatCadStatusLines(input: {
  cliVersion: string;
  paired: boolean;
  platform?: string;
  machineName?: string;
  orgId?: string;
  baseUrl?: string;
  serverReachable?: boolean;
  serverDetail?: string;
  storage: string;
  bound: ClaudeCadSession | null;
  sync: { queued: number; lastSyncedAt: string | null };
}): string[] {
  const lines = [`vantage-cad status ${input.cliVersion}`];
  const tag = (status: "pass" | "warn" | "fail" | "skip") => `[${status.toUpperCase().padEnd(4)}]`;

  if (input.paired) {
    lines.push(
      `${tag("pass")} Login: paired as ${input.machineName ?? "this machine"} · platform ${
        input.platform ?? "unknown"
      } · org ${input.orgId ?? "unknown"}`,
    );
    if (input.serverReachable) {
      lines.push(`${tag("pass")} Server: reachable at ${input.baseUrl ?? "the Vantage app"}`);
    } else {
      lines.push(
        `${tag("warn")} Server: unreachable${input.serverDetail ? ` (${input.serverDetail})` : ""} — CAD tools keep working locally; activity syncs when the connection returns`,
      );
    }
  } else {
    lines.push(`${tag("fail")} Login: not paired — run \`vantage-cad setup\` to link this machine to your team`);
  }

  if (input.bound?.documentId) {
    const name = input.bound.documentName ? `"${input.bound.documentName}"` : "(unnamed document)";
    lines.push(
      `${tag("pass")} Binding: Onshape Part Studio ${name} · doc ${input.bound.documentId.slice(0, 12)}… element ${
        (input.bound.elementId ?? "").slice(0, 12) || "?"
      }`,
    );
  } else {
    lines.push(
      `${tag("warn")} Binding: no Part Studio bound — run \`vantage-cad onshape bind --document ID --workspace ID --element ID\` (disposable docs only)`,
    );
  }

  if (!input.paired) {
    lines.push(`${tag("skip")} Sync: off — terminal CAD sessions stay local until you pair`);
  } else if (input.sync.queued > 0) {
    lines.push(
      `${tag("warn")} Sync: ${input.sync.queued} event${input.sync.queued === 1 ? "" : "s"} queued — retried on the next CAD command`,
    );
  } else if (input.sync.lastSyncedAt) {
    lines.push(`${tag("pass")} Sync: up to date · last synced ${input.sync.lastSyncedAt}`);
  } else {
    lines.push(`${tag("pass")} Sync: ready — sessions appear on the /cad page after the first CAD command`);
  }

  lines.push(`Credential storage: ${input.storage}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Reporter (filesystem + network edges, injectable for tests)
// ---------------------------------------------------------------------------

export type CadSyncReporter = {
  sessionStart(): Promise<void>;
  /** Report one tool call inside a long-lived (MCP) session. Non-mutating tools are ignored. */
  toolCall(tool: string, args: Record<string, unknown>, ok: boolean, error?: string): Promise<void>;
  sessionEnd(status?: "completed" | "failed"): Promise<void>;
  /** One-shot CLI command: a single post that records the event and closes the session state. */
  oneShotToolCall(tool: string, args: Record<string, unknown>, ok: boolean, error?: string): Promise<void>;
};

export type CadSyncReporterOptions = {
  dir?: string;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
  loadCredential?: () => Promise<Record<string, string> | null>;
  loadBoundSession?: () => Promise<ClaudeCadSession>;
  now?: () => number;
};

const defaultDir = () => join(homedir(), ".vantage-cad");
const stateFile = (dir: string) => join(dir, "sync-state.json");

export async function readCadSyncState(dir = defaultDir()): Promise<CadSyncState | null> {
  try {
    const raw = JSON.parse(await readFile(stateFile(dir), "utf8")) as CadSyncState;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

async function writeCadSyncState(dir: string, state: CadSyncState): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(stateFile(dir), `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readCadSyncStatus(dir = defaultDir()): Promise<{ queued: number; lastSyncedAt: string | null }> {
  const state = await readCadSyncState(dir);
  return {
    queued: Array.isArray(state?.queue) ? state.queue.length : 0,
    lastSyncedAt: state?.lastSyncedAt ?? null,
  };
}

export function createCadSyncReporter(options: CadSyncReporterOptions = {}): CadSyncReporter {
  const dir = options.dir ?? defaultDir();
  const log = options.log ?? ((line: string) => console.error(line));
  const fetchImpl = options.fetchImpl ?? fetch;
  const loadCredential = options.loadCredential ?? loadDeviceCredential;
  const loadBound = options.loadBoundSession ?? loadClaudeCadSession;
  const now = options.now ?? Date.now;

  let warnedUnpaired = false;
  let warnedOffline = false;
  let warnedRevoked = false;

  async function credential(): Promise<{ deviceToken: string; baseUrl: string } | null> {
    const value = await loadCredential().catch(() => null);
    if (!value?.deviceToken || !value.baseUrl) {
      if (!warnedUnpaired) {
        warnedUnpaired = true;
        log(
          "vantage-cad: not paired — this session stays local and will not appear on the team's /cad page. Run `vantage-cad setup` to sync (CAD tools work either way).",
        );
      }
      return null;
    }
    return { deviceToken: value.deviceToken, baseUrl: value.baseUrl };
  }

  async function postOnce(
    cred: { deviceToken: string; baseUrl: string },
    payload: CadSyncPayload,
  ): Promise<"ok" | "offline" | "rejected"> {
    try {
      const response = await fetchImpl(`${cred.baseUrl.replace(/\/$/, "")}/api/cad/sync`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cred.deviceToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (response.ok) return "ok";
      if (response.status === 401) {
        if (!warnedRevoked) {
          warnedRevoked = true;
          log("vantage-cad: device token was revoked — run `vantage-cad setup` again to resume web sync. Working locally.");
        }
        return "rejected";
      }
      // 4xx validation problems will not succeed on retry either.
      return response.status >= 400 && response.status < 500 ? "rejected" : "offline";
    } catch {
      return "offline";
    }
  }

  /** Flush queued payloads then this one; queue on network failure. Never throws. */
  async function deliver(status: CadSyncPayload["status"], event: CadSyncEvent | null) {
    try {
      const cred = await credential();
      if (!cred) return;
      let state = ensureFreshSyncSession(await readCadSyncState(dir), now());
      const outgoing: CadSyncPayload = {
        sessionId: state.sessionId,
        platform: event ? cadToolPlatform(event.tool) : null,
        documentRef: null,
        event,
        status,
      };
      if (event && event.tool.startsWith("onshape_")) {
        const bound = await loadBound().catch(() => ({}) as ClaudeCadSession);
        outgoing.documentRef = documentRefFromBoundSession(bound);
      }

      const pending = [...state.queue, outgoing];
      const remaining: CadSyncPayload[] = [];
      let offline = false;
      for (const item of pending) {
        if (offline) {
          remaining.push(item);
          continue;
        }
        const result = await postOnce(cred, item);
        if (result === "offline") {
          offline = true;
          remaining.push(item);
        }
        // "rejected" payloads are dropped — retrying cannot fix them.
      }
      state = {
        ...state,
        queue: remaining.length > SYNC_QUEUE_LIMIT ? remaining.slice(remaining.length - SYNC_QUEUE_LIMIT) : remaining,
        lastSyncedAt: offline && remaining.length === pending.length ? state.lastSyncedAt : new Date(now()).toISOString(),
      };
      await writeCadSyncState(dir, state);
      if (offline && !warnedOffline) {
        warnedOffline = true;
        log(
          `vantage-cad: Vantage app unreachable — continuing locally; ${state.queue.length} sync event${
            state.queue.length === 1 ? "" : "s"
          } queued and retried on the next CAD command.`,
        );
      } else if (!offline) {
        warnedOffline = false;
      }
    } catch {
      // Sync must never break CAD work.
    }
  }

  async function eventFor(tool: string, args: Record<string, unknown>, ok: boolean, error?: string): Promise<CadSyncEvent> {
    return {
      tool,
      params: summarizeCadSyncParams(args),
      at: new Date(now()).toISOString(),
      ok,
      ...(error ? { error: clip(error, 300) } : {}),
    };
  }

  return {
    async sessionStart() {
      await deliver("running", null);
    },
    async toolCall(tool, args, ok, error) {
      if (!MUTATING_CAD_TOOLS.has(tool)) return;
      await deliver("running", await eventFor(tool, args, ok, error));
    },
    async sessionEnd(status = "completed") {
      await deliver(status, null);
    },
    async oneShotToolCall(tool, args, ok, error) {
      if (!MUTATING_CAD_TOOLS.has(tool)) return;
      await deliver(ok ? "completed" : "failed", await eventFor(tool, args, ok, error));
    },
  };
}
