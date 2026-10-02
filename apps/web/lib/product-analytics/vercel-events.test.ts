import { describe, expect, it } from "vitest";
import { sanitizeVercelPageView } from "./vercel-events";

describe("Vercel page-view boundary", () => {
  it("excludes views without consent and all custom content events", () => {
    expect(sanitizeVercelPageView({ type: "pageview", url: "https://vantagefrc.vercel.app/dashboard" }, false)).toBeNull();
    expect(sanitizeVercelPageView({ type: "event", url: "https://vantagefrc.vercel.app/chat" }, true)).toBeNull();
  });
  it("removes credentials, query data, fragments and record identifiers", () => {
    expect(sanitizeVercelPageView({ type: "pageview", url: "https://name:password@vantagefrc.vercel.app/team/00000000-0000-4000-8000-000000000001?orgId=private&q=student#invite-token" }, true))
      .toEqual({ type: "pageview", url: "https://vantagefrc.vercel.app/team/:id" });
    expect(sanitizeVercelPageView({ type: "pageview", url: "https://vantagefrc.vercel.app/invite/secret_invitation_token_123" }, true))
      .toEqual({ type: "pageview", url: "https://vantagefrc.vercel.app/invite/:id" });
  });
  it("retains public route names and drops malformed or non-web URLs", () => {
    expect(sanitizeVercelPageView({ type: "pageview", url: "https://vantagefrc.vercel.app/dashboard" }, true))
      .toEqual({ type: "pageview", url: "https://vantagefrc.vercel.app/dashboard" });
    for (const url of ["not a URL", "file:///secret"]) expect(sanitizeVercelPageView({ type: "pageview", url }, true)).toBeNull();
  });
});
