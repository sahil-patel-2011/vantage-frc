import { describe, expect, it, vi } from "vitest";
import { CadDesktopController, type CadWorkerHandle } from "../src/cad-controller";

const orgId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  let receive: (value: unknown) => void = () => undefined;
  const exits: Array<() => void> = [];
  const worker: CadWorkerHandle = {
    postMessage: vi.fn((value) => {
      const message = value as { type: string; id?: string };
      if (message.type === "stop") { for (const exit of exits) exit(); }
      if (message.type === "start") queueMicrotask(() => receive({ type: "result", id: message.id, ok: true, value: { browserOpen: true } }));
      if (message.type === "tool") queueMicrotask(() => receive({ type: "result", id: message.id, ok: true, value: { observation: "only-this-worker" } }));
    }),
    kill: vi.fn(), onMessage: (listener) => { receive = listener; }, onExit: (listener) => { exits.push(listener); },
  };
  const assets = vi.fn(async () => ({ root: "/packaged/onshape-ui", worker: "/packaged/onshape-ui/worker.cjs", browserExecutable: "/packaged/onshape-ui/browser/chrome" }));
  const sessionIdentity = vi.fn(async (): Promise<string | null> => "session-one");
  const authorize = vi.fn(async () => undefined);
  const spawn = vi.fn(() => worker);
  const changed = vi.fn();
  const controller = new CadDesktopController({ assets, sessionIdentity, authorize, spawn, changed });
  return { controller, assets, sessionIdentity, authorize, spawn, worker, changed };
}

describe("on-demand desktop CAD controller", () => {
  it("status never launches and missing staged resources fail honestly", async () => {
    const f = fixture();
    expect((await f.controller.status()).phase).toBe("idle");
    expect(f.spawn).not.toHaveBeenCalled();
    f.assets.mockResolvedValue(null as never);
    expect((await f.controller.start({ orgId })).phase).toBe("setup_required");
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });

  it("does not start a browser for denied or absent Vantage sessions", async () => {
    const f = fixture();
    f.sessionIdentity.mockResolvedValue(null);
    expect((await f.controller.start({ orgId })).phase).toBe("error");
    expect(f.spawn).not.toHaveBeenCalled();
    f.sessionIdentity.mockResolvedValue("session-one");
    f.authorize.mockRejectedValue(new Error("Team access denied"));
    expect((await f.controller.start({ orgId })).phase).toBe("error");
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("starts only after authorization and checks the same session before tool execution", async () => {
    const f = fixture();
    expect((await f.controller.start({ orgId })).phase).toBe("browser_open");
    expect(f.authorize).toHaveBeenCalledWith(orgId);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(await f.controller.tool({ name: "observe" })).toEqual({ observation: "only-this-worker" });
    f.sessionIdentity.mockResolvedValue("session-two");
    await expect(f.controller.tool({ name: "observe" })).rejects.toThrow("sign-in changed");
    await f.controller.sessionChanged();
    expect((await f.controller.status()).phase).toBe("idle");
  });

  it("prevents overlapping starts and resets errors through explicit stop", async () => {
    const f = fixture();
    await f.controller.start({ orgId });
    await expect(f.controller.start({ orgId })).rejects.toThrow("Close the current");
    expect((await f.controller.stop()).phase).toBe("idle");
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it("closes the owned browser when current team access is denied", async () => {
    const f = fixture();
    await f.controller.start({ orgId });
    f.authorize.mockRejectedValueOnce(new Error("Membership revoked"));
    await expect(f.controller.tool({ name: "observe" })).rejects.toThrow("Membership revoked");
    expect(f.worker.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(f.controller.running).toBe(false);
  });

  it("never spawns after the user stops during an unfinished resource check", async () => {
    const f = fixture();
    let finish!: (value: Awaited<ReturnType<typeof f.assets>>) => void;
    const assets = { root: "/packaged", worker: "/packaged/worker.cjs", browserExecutable: "/packaged/browser" };
    f.assets.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const starting = f.controller.start({ orgId });
    await f.controller.stop();
    finish(assets);
    expect((await starting).phase).toBe("idle");
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("does not let an older resource-status read overwrite a newly opened browser", async () => {
    const f = fixture();
    let finish!: (value: Awaited<ReturnType<typeof f.assets>>) => void;
    const assets = { root: "/packaged", worker: "/packaged/worker.cjs", browserExecutable: "/packaged/browser" };
    f.assets.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pendingStatus = f.controller.status();
    await f.controller.start({ orgId });
    finish(assets);
    expect((await pendingStatus).phase).toBe("browser_open");
    await f.controller.stop();
  });

  it("does not send a stale tool into a replacement browser after authorization returns", async () => {
    const f = fixture();
    await f.controller.start({ orgId });
    let release!: () => void;
    let entered!: () => void;
    const checking = new Promise<void>((resolve) => { entered = resolve; });
    f.authorize.mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    const oldTool = f.controller.tool({ name: "observe" });
    await checking;
    await f.controller.stop();
    await f.controller.start({ orgId });
    vi.mocked(f.worker.postMessage).mockClear();
    release();
    await expect(oldTool).rejects.toThrow("browser changed");
    expect(f.worker.postMessage).not.toHaveBeenCalled();
    expect(f.controller.running).toBe(true);
    await f.controller.stop();
  });
});
