import type { Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createOnshapeUiBrowserSession } from "./browser-session";
import type { createOnshapeUiSetup } from "./setup";

function fixture() {
  const authorize = vi.fn(async () => ({ deviceToken: "approved-token" }));
  const status = vi.fn(async () => ({ status: "eligible", message: "Access confirmed" }));
  const setup = { authorize, status } as unknown as ReturnType<typeof createOnshapeUiSetup>;
  const page = { once: vi.fn(), goto: vi.fn(async () => undefined) };
  const context = { newPage: vi.fn(async () => page), on: vi.fn(), close: vi.fn(async () => undefined) };
  const browser = { newContext: vi.fn(async () => context), once: vi.fn(), close: vi.fn(async () => undefined), isConnected: vi.fn(() => false) };
  const launch = vi.fn(async () => browser as unknown as Browser);
  const resolveBrowser = vi.fn(async () => "/approved/browser");
  const session = createOnshapeUiBrowserSession({ setup, launch, resolveBrowser });
  return { session, authorize, status, page, context, browser, launch, resolveBrowser };
}

describe("explicit Onshape browser lifecycle", () => {
  it("performs no setup IO or launch at construction; status cannot launch", async () => {
    const f = fixture();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.status).not.toHaveBeenCalled();
    expect(f.resolveBrowser).not.toHaveBeenCalled();
    expect(f.launch).not.toHaveBeenCalled();
    expect(await f.session.status()).toMatchObject({ browser: "closed", status: "eligible" });
    expect(f.launch).not.toHaveBeenCalled();
  });

  it("reports missing resources through status and refuses launch while leaving setup accessible", async () => {
    const f = fixture(); f.resolveBrowser.mockRejectedValue(new Error("Missing resource"));
    expect(await f.session.status()).toMatchObject({ browser: "closed", status: "setup_required" });
    await expect(f.session.start("https://cad.onshape.com/documents")).rejects.toThrow("packaged browser is missing");
    expect(f.launch).not.toHaveBeenCalled();
    expect(await f.session.status()).toMatchObject({ status: "setup_required" });
  });

  it("requires current approval before opening and closes after a denied status check", async () => {
    const f = fixture(); f.authorize.mockRejectedValueOnce(new Error("Approve the device"));
    await expect(f.session.start("https://cad.onshape.com/documents")).rejects.toThrow("Approve the device");
    expect(f.launch).not.toHaveBeenCalled();
    expect(await f.session.start("https://cad.onshape.com/documents")).toMatchObject({ browser: "open" });
    f.status.mockResolvedValue({ status: "denied", message: "Membership removed" });
    expect(await f.session.status()).toMatchObject({ browser: "closed", status: "denied" });
    expect(f.browser.close).toHaveBeenCalled();
  });

  it("explicit stop closes owned context and browser but permits another approved start", async () => {
    const f = fixture();
    await f.session.start("https://cad.onshape.com/documents");
    await f.session.stop();
    expect(f.context.close).toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalled();
    expect(await f.session.start("https://cad.onshape.com/documents")).toMatchObject({ browser: "open" });
    expect(f.launch).toHaveBeenCalledTimes(2);
  });

  it("closes a browser whose launch completes after cancellation", async () => {
    const f = fixture();
    let resolveLaunch!: (browser: Browser) => void;
    f.launch.mockImplementationOnce(() => new Promise<Browser>((resolve) => { resolveLaunch = resolve; }));
    const starting = f.session.start("https://cad.onshape.com/documents");
    const rejected = expect(starting).rejects.toThrow("cancelled");
    for (let tick = 0; tick < 10 && !resolveLaunch; tick += 1) await Promise.resolve();
    expect(f.launch).toHaveBeenCalledTimes(1);
    const stopping = f.session.stop();
    resolveLaunch(f.browser as unknown as Browser);
    await stopping; await rejected;
    expect(f.browser.close).toHaveBeenCalled();
    expect(f.browser.newContext).not.toHaveBeenCalled();
  });

  it("does not claim closure or permit another writer when browser shutdown is unconfirmed", async () => {
    const f = fixture();
    await f.session.start("https://cad.onshape.com/documents");
    f.browser.close.mockRejectedValueOnce(new Error("Transport failed"));
    f.browser.isConnected.mockReturnValueOnce(true);
    await expect(f.session.stop()).rejects.toThrow("closure could not be confirmed");
    await expect(f.session.start("https://cad.onshape.com/documents")).rejects.toThrow("Stop the current");
    await f.session.stop();
    expect(await f.session.status()).toMatchObject({ browser: "closed" });
  });
});
