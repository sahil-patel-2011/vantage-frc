import { describe, expect, it, vi } from "vitest";
import type { OnshapeBrowserSession } from "../../cad/src/onshape-session-store";
import { createPlaywrightOnshapeSessionManager } from "../src/onshape-browser-http";

const SESSION: OnshapeBrowserSession = {
  version: 1,
  baseUrl: "https://cad.onshape.com",
  capturedAt: "2026-08-31T12:00:00.000Z",
  cookies: [
    {
      name: "session",
      value: "secret-never-logged",
      domain: ".onshape.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
};

function fakePlaywright(outputUrl = "https://cad.onshape.com/api/v6/users/current") {
  const evaluate = vi.fn(async (_callback: unknown, input: unknown) => ({
    status: 200,
    statusText: "OK",
    url: outputUrl,
    redirected: false,
    headers: { "content-type": "application/json" },
    bodyBase64: Buffer.from(JSON.stringify({ id: "user-1" })).toString("base64"),
    input,
  }));
  const page = {
    goto: vi.fn(async () => undefined),
    url: vi.fn(() => "https://cad.onshape.com/documents"),
    evaluate,
  };
  const context = {
    addCookies: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
    on: vi.fn(),
  };
  return {
    module: { chromium: { launch: vi.fn(async () => browser) } },
    browser,
    context,
    page,
    evaluate,
  };
}

describe("Playwright Onshape session transport", () => {
  it("executes API requests in the signed-in browser page and reuses it", async () => {
    const fake = fakePlaywright();
    const manager = createPlaywrightOnshapeSessionManager(
      {},
      async () => fake.module as never,
    );
    const first = await manager.sessionHttpFactory(SESSION, {});
    const response = await first("/users/current");
    const second = await manager.sessionHttpFactory(SESSION, {});
    await second("/documents?limit=1");

    expect(await response.json()).toEqual({ id: "user-1" });
    expect(fake.module.chromium.launch).toHaveBeenCalledTimes(1);
    expect(fake.context.addCookies).toHaveBeenCalledWith(SESSION.cookies);
    expect(fake.evaluate).toHaveBeenCalledTimes(2);
    expect(fake.evaluate.mock.calls[0]?.[1]).toMatchObject({
      url: "https://cad.onshape.com/api/v6/users/current",
      method: "GET",
    });
    await manager.close();
    expect(fake.browser.close).toHaveBeenCalledTimes(1);
  });

  it("treats a redirect to sign-in as an expired session", async () => {
    const fake = fakePlaywright("https://cad.onshape.com/signin");
    const manager = createPlaywrightOnshapeSessionManager(
      {},
      async () => fake.module as never,
    );
    const http = await manager.sessionHttpFactory(SESSION, {});
    await expect(http("/users/current")).rejects.toMatchObject({
      code: "onshape_session_expired",
      setupRequired: true,
    });
  });
});
