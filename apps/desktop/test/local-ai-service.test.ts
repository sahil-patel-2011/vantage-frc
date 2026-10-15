import { describe, expect, it, vi } from "vitest";
import { LocalAiService, type LocalAiConfig } from "../src/local-ai-service";

const ORIGIN = "https://vantagefrc.vercel.app";
const GiB = 1024 ** 3;

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function harness(routes: Record<string, Route>, options: { saved?: Partial<LocalAiConfig>; memGb?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((prefix) => url.includes(prefix) && (!prefix.includes(" ") || prefix.startsWith(`${init.method ?? "GET"} `)));
    const exact = Object.keys(routes).find((prefix) => prefix === `${init.method ?? "GET"} ${new URL(url).pathname}`);
    const route = routes[exact ?? key ?? ""];
    if (!route) throw new TypeError(`no route for ${init.method ?? "GET"} ${url}`);
    return route(url, init);
  });
  let saved: LocalAiConfig | null = null;
  const opened: string[] = [];
  const service = new LocalAiService({
    origin: ORIGIN,
    machineName: "Pit laptop",
    bridgeVersion: "desktop-local-test",
    fetcher: fetcher as unknown as typeof fetch,
    readConfig: async () => options.saved ?? null,
    writeConfig: async (config) => {
      saved = config;
    },
    system: async () => ({ totalMemBytes: (options.memGb ?? 32) * GiB, freeDiskBytes: 100e9 }),
    openApproval: (url) => opened.push(url),
    onStatus: () => undefined,
    sleep: async () => undefined,
  });
  return { service, calls, opened, saved: () => saved };
}

const models = () => Response.json({ data: [{ id: "qwen3-8b" }] });

describe("LocalAiService", () => {
  it("finds LM Studio's Qwen model and reports the machine's capacity", async () => {
    const { service } = harness({ "GET /v1/models": models });
    await service.start();
    const status = service.status();
    expect(status.reachable).toBe(true);
    expect(status.model).toBe("qwen3-8b");
    expect(status.requirements.ok).toBe(true);
  });

  it("won't switch on below 16 GB of memory, and says why", async () => {
    const { service } = harness({ "GET /v1/models": models }, { memGb: 8 });
    await service.start();
    const status = await service.setEnabled(true);
    expect(status.enabled).toBe(false);
    expect(status.lastError).toMatch(/16 GB of memory/);
  });

  it("pairs through the approval page on the app's own origin and saves the device token", async () => {
    let polls = 0;
    const { service, opened, saved } = harness({
      "GET /v1/models": models,
      "POST /api/ai-bridge/device/pair/start": () =>
        Response.json({ userCode: "ABCD-EFGH", pollToken: "poll", verificationUri: `${ORIGIN}/team/ai-bridge?code=ABCD-EFGH`, interval: 1 }),
      "POST /api/ai-bridge/device/pair/poll": () =>
        Response.json(++polls < 2 ? { status: "pending" } : { status: "approved", deviceToken: "dev-token", deviceId: "d1", orgId: "o1", userId: "u1" }),
    });
    await service.start();
    const status = await service.pair();
    expect(opened).toEqual([`${ORIGIN}/team/ai-bridge?code=ABCD-EFGH`]);
    expect(status.paired).toBe(true);
    expect(saved()?.deviceToken).toBe("dev-token");
    expect(saved()?.userId).toBe("u1");
  });

  it("refuses an approval address that isn't the app's origin", async () => {
    const { service, opened } = harness({
      "GET /v1/models": models,
      "POST /api/ai-bridge/device/pair/start": () =>
        Response.json({ userCode: "ABCD-EFGH", pollToken: "poll", verificationUri: "https://evil.example/approve" }),
    });
    await service.start();
    const status = await service.pair();
    expect(opened).toEqual([]);
    expect(status.paired).toBe(false);
    expect(status.lastError).toMatch(/unexpected address/);
  });

  it("answers the paired person's queued request with the local model and reports it done", async () => {
    let claimed = false;
    const done = vi.fn();
    const { service, calls } = harness(
      {
        "GET /v1/models": models,
        "POST /v1/chat/completions": () => Response.json({ model: "qwen3-8b", choices: [{ message: { content: "Run a defender on 254." } }] }),
        "POST /api/ai-bridge/device/heartbeat": () => Response.json({ ok: true }),
        "POST /api/ai-bridge/device/jobs": () => {
          if (claimed) {
            void service.setEnabled(false);
            return new Response(null, { status: 204 });
          }
          claimed = true;
          return Response.json({ jobId: "j1", orgId: "o1", userId: "u1", feature: "chat", messages: { prompt: "plan match 50" }, leaseToken: "lease" });
        },
        "PUT /api/ai-bridge/device/jobs": () => Response.json({ active: true }),
        "PATCH /api/ai-bridge/device/jobs": async (_url, init) => {
          done(JSON.parse(String(init.body)));
          return Response.json({ success: true });
        },
      },
      { saved: { enabled: true, deviceToken: "dev-token", userId: "u1", orgId: "o1" } },
    );
    await service.start();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0]?.[0]).toMatchObject({ jobId: "j1", state: "done", result: { text: "Run a defender on 254.", engine: "lmstudio" } });
    const heartbeat = calls.find((call) => call.url.endsWith("/heartbeat"));
    expect(JSON.parse(String(heartbeat?.init.body)).engines.lmstudio).toMatchObject({ available: true, model: "qwen3-8b" });
    expect((heartbeat?.init.headers as Record<string, string>).authorization).toBe("Bearer dev-token");
  });
});
