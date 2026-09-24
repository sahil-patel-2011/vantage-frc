import { describe, expect, it } from "vitest";
import { checkProviderKey } from "./check-provider-key";

function fakeFetch(status: number, body = ""): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch;
}

describe("checkProviderKey", () => {
  it("accepts a key the provider answers 200 for", async () => {
    expect(await checkProviderKey("openai", "sk-good", fakeFetch(200, "{}"))).toEqual({ status: "valid" });
  });

  it("rejects a key the provider refuses, with where to copy it again", async () => {
    const result = await checkProviderKey("anthropic", "hello", fakeFetch(401));
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.message).toMatch(/Anthropic didn't accept this key/);
  });

  it("reads Google's 400 'API key not valid' as a rejection", async () => {
    const result = await checkProviderKey("google", "hello", fakeFetch(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'));
    expect(result.status).toBe("rejected");
  });

  it("stores the key anyway when the provider cannot be reached", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const result = await checkProviderKey("openrouter", "sk-or-x", offline);
    expect(result.status).toBe("unchecked");
  });

  it("does not reject on a provider outage", async () => {
    expect((await checkProviderKey("openai", "sk-x", fakeFetch(503))).status).toBe("unchecked");
  });

  it("sends the Google key in a header, never the URL", async () => {
    let seen = "";
    let header = "";
    const spy = (async (url: string, init?: RequestInit) => {
      seen = url;
      header = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await checkProviderKey("google", "AIzaSECRET", spy);
    expect(seen).not.toContain("AIzaSECRET");
    expect(header).toBe("AIzaSECRET");
  });
});
