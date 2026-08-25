import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MUTATING_CAD_TOOLS,
  SYNC_QUEUE_LIMIT,
  SYNC_SESSION_MAX_AGE_MS,
  cadToolPlatform,
  createCadSyncReporter,
  documentRefFromBoundSession,
  enqueueBounded,
  ensureFreshSyncSession,
  formatCadStatusLines,
  newCadSyncSessionId,
  readCadSyncStatus,
  summarizeCadSyncParams,
  type CadSyncPayload,
  type CadSyncState,
} from "../src/sync";

const tempDirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "vantage-cad-sync-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("sync session identity", () => {
  it("generates URL-safe ids the server accepts", () => {
    const id = newCadSyncSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newCadSyncSessionId()).not.toBe(id);
  });

  it("reuses a fresh rolling session and rotates a stale one", () => {
    const now = Date.now();
    const fresh: CadSyncState = {
      sessionId: "t_fresh123",
      sessionStartedAt: new Date(now - 60_000).toISOString(),
      lastSyncedAt: null,
      queue: [],
    };
    expect(ensureFreshSyncSession(fresh, now).sessionId).toBe("t_fresh123");
    const stale = { ...fresh, sessionStartedAt: new Date(now - SYNC_SESSION_MAX_AGE_MS - 1).toISOString() };
    const rotated = ensureFreshSyncSession(stale, now);
    expect(rotated.sessionId).not.toBe("t_fresh123");
    expect(ensureFreshSyncSession(null, now).sessionId).toMatch(/^t_/);
  });
});

describe("payload shaping", () => {
  it("classifies platforms from tool names and keeps only mutating tools in the sync set", () => {
    expect(cadToolPlatform("onshape_extrude")).toBe("onshape");
    expect(cadToolPlatform("fusion_sketch_rectangle")).toBe("fusion360");
    expect(cadToolPlatform("cad_status")).toBeNull();
    expect(MUTATING_CAD_TOOLS.has("onshape_extrude")).toBe(true);
    expect(MUTATING_CAD_TOOLS.has("onshape_list_documents")).toBe(false);
    expect(MUTATING_CAD_TOOLS.has("cad_status")).toBe(false);
  });

  it("summarizes params without secrets, nesting, or unbounded strings", () => {
    const summary = summarizeCadSyncParams({
      widthMm: 40,
      plane: "Top",
      accessKey: "NEVER",
      secret_key: "NEVER",
      nested: { deep: true },
      long: "x".repeat(500),
    });
    expect(summary).not.toHaveProperty("accessKey");
    expect(summary).not.toHaveProperty("secret_key");
    expect(summary).not.toHaveProperty("nested");
    expect(summary.widthMm).toBe(40);
    expect(String(summary.long).length).toBe(80);
  });

  it("builds a document ref only when something is bound", () => {
    expect(documentRefFromBoundSession({})).toBeNull();
    expect(
      documentRefFromBoundSession({ documentId: "d1", workspaceId: "w1", elementId: "e1", documentName: "Scratch" }),
    ).toEqual({ documentId: "d1", workspaceId: "w1", elementId: "e1", documentName: "Scratch" });
  });

  it("bounds the retry queue", () => {
    let queue: CadSyncPayload[] = [];
    for (let index = 0; index < SYNC_QUEUE_LIMIT + 10; index += 1) {
      queue = enqueueBounded(queue, {
        sessionId: `session-${index}`,
        platform: null,
        documentRef: null,
        event: null,
        status: "running",
      });
    }
    expect(queue.length).toBe(SYNC_QUEUE_LIMIT);
    expect(queue[0]!.sessionId).toBe("session-10");
  });
});

describe("status lines", () => {
  it("shows unpaired state with the resolving action", () => {
    const lines = formatCadStatusLines({
      cliVersion: "0.1.1",
      paired: false,
      storage: "OS credential storage available",
      bound: null,
      sync: { queued: 0, lastSyncedAt: null },
    }).join("\n");
    expect(lines).toContain("not paired");
    expect(lines).toContain("vantage-cad setup");
    expect(lines).toContain("Sync: off");
  });

  it("shows paired + bound + queued sync honestly", () => {
    const lines = formatCadStatusLines({
      cliVersion: "0.1.1",
      paired: true,
      platform: "onshape",
      machineName: "SHOP-PC",
      orgId: "org-1",
      baseUrl: "https://vantage.example",
      serverReachable: false,
      serverDetail: "fetch failed",
      storage: "file",
      bound: { documentId: "d123456789012345", workspaceId: "w1", elementId: "e1", documentName: "Scratch" },
      sync: { queued: 3, lastSyncedAt: "2026-08-23T10:00:00.000Z" },
    }).join("\n");
    expect(lines).toContain("paired as SHOP-PC");
    expect(lines).toContain("unreachable");
    expect(lines).toContain('"Scratch"');
    expect(lines).toContain("3 events queued");
  });
});

describe("reporter", () => {
  const credential = async () => ({ deviceToken: "token", baseUrl: "https://vantage.example" });

  it("stays silent and local when not paired, warning exactly once", async () => {
    const dir = await tempDir();
    const logs: string[] = [];
    let fetched = 0;
    const reporter = createCadSyncReporter({
      dir,
      log: (line) => logs.push(line),
      loadCredential: async () => null,
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    await reporter.sessionStart();
    await reporter.toolCall("onshape_extrude", { depthMm: 10 }, true);
    await reporter.sessionEnd();
    expect(fetched).toBe(0);
    expect(logs.filter((line) => line.includes("not paired")).length).toBe(1);
  });

  it("posts mutating tool calls with the paired device token and ignores read-only tools", async () => {
    const dir = await tempDir();
    const posts: Array<{ url: string; auth: string | null; body: CadSyncPayload }> = [];
    const reporter = createCadSyncReporter({
      dir,
      log: () => undefined,
      loadCredential: credential,
      loadBoundSession: async () => ({ documentId: "d1", workspaceId: "w1", elementId: "e1", documentName: "Scratch" }),
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        posts.push({
          url: String(url),
          auth: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)) as CadSyncPayload,
        });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await reporter.toolCall("onshape_list_documents", {}, true);
    await reporter.toolCall("onshape_extrude", { depthMm: 10, secretKey: "NO" }, true);
    expect(posts.length).toBe(1);
    expect(posts[0]!.url).toBe("https://vantage.example/api/cad/sync");
    expect(posts[0]!.auth).toBe("Bearer token");
    expect(posts[0]!.body.event?.tool).toBe("onshape_extrude");
    expect(posts[0]!.body.event?.params).toEqual({ depthMm: 10 });
    expect(posts[0]!.body.documentRef?.documentName).toBe("Scratch");
    expect(posts[0]!.body.status).toBe("running");
    const status = await readCadSyncStatus(dir);
    expect(status.queued).toBe(0);
    expect(status.lastSyncedAt).not.toBeNull();
  });

  it("queues on network failure with a single warning, then flushes when the app returns", async () => {
    const dir = await tempDir();
    const logs: string[] = [];
    let online = false;
    const delivered: CadSyncPayload[] = [];
    const reporter = createCadSyncReporter({
      dir,
      log: (line) => logs.push(line),
      loadCredential: credential,
      loadBoundSession: async () => ({}),
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (!online) throw new Error("offline");
        delivered.push(JSON.parse(String(init?.body)) as CadSyncPayload);
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await reporter.oneShotToolCall("fusion_extrude", { depthMm: 10 }, true);
    await reporter.oneShotToolCall("fusion_sketch_rectangle", { widthMm: 40, heightMm: 20 }, true);
    expect((await readCadSyncStatus(dir)).queued).toBe(2);
    expect(logs.filter((line) => line.includes("unreachable")).length).toBe(1);
    const raw = JSON.parse(await readFile(join(dir, "sync-state.json"), "utf8")) as CadSyncState;
    expect(raw.queue.length).toBe(2);

    online = true;
    await reporter.oneShotToolCall("fusion_extrude", { depthMm: 5 }, false, "Fusion add-in not reachable");
    expect(delivered.length).toBe(3);
    expect(delivered[0]!.event?.tool).toBe("fusion_extrude");
    expect(delivered[2]!.status).toBe("failed");
    expect(delivered[2]!.event?.error).toContain("not reachable");
    expect((await readCadSyncStatus(dir)).queued).toBe(0);
  });

  it("drops payloads on 401 with a re-pair hint instead of retrying forever", async () => {
    const dir = await tempDir();
    const logs: string[] = [];
    const reporter = createCadSyncReporter({
      dir,
      log: (line) => logs.push(line),
      loadCredential: credential,
      loadBoundSession: async () => ({}),
      fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch,
    });
    await reporter.oneShotToolCall("fusion_extrude", { depthMm: 10 }, true);
    await reporter.oneShotToolCall("fusion_extrude", { depthMm: 12 }, true);
    expect((await readCadSyncStatus(dir)).queued).toBe(0);
    expect(logs.filter((line) => line.includes("vantage-cad setup")).length).toBe(1);
  });
});
