import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseSecureJson, RequestSecurityError } from "./request";

const schema = z.object({ action: z.literal("save") }).strict();

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://vantage.example/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("parseSecureJson", () => {
  it("accepts a small strict same-origin payload", async () => {
    await expect(parseSecureJson(request('{"action":"save"}', { origin: "https://vantage.example" }), schema))
      .resolves.toEqual({ action: "save" });
  });

  it("blocks cross-site and mismatched-origin mutations", async () => {
    await expect(parseSecureJson(request('{"action":"save"}', { "sec-fetch-site": "cross-site" }), schema))
      .rejects.toMatchObject<RequestSecurityError>({ status: 403 });
    await expect(parseSecureJson(request('{"action":"save"}', { origin: "https://evil.example" }), schema))
      .rejects.toMatchObject<RequestSecurityError>({ status: 403 });
  });

  it("rejects non-JSON, unknown fields, and oversized bodies", async () => {
    await expect(parseSecureJson(new Request("https://vantage.example/api/test", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
    }), schema)).rejects.toMatchObject<RequestSecurityError>({ status: 415 });
    await expect(parseSecureJson(request('{"action":"save","admin":true}'), schema))
      .rejects.toMatchObject<RequestSecurityError>({ status: 400 });
    await expect(parseSecureJson(request(JSON.stringify({ action: "save", padding: "x".repeat(100) })), schema, { maxBytes: 32 }))
      .rejects.toMatchObject<RequestSecurityError>({ status: 413 });
  });
});
