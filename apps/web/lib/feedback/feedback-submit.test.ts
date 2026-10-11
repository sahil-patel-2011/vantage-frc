import { describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_NOT_SENT,
  buildFeedbackPayload,
  feedbackErrorMessage,
  sendFeedback,
} from "./feedback-submit";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("buildFeedbackPayload", () => {
  it("carries the words, the page, the team and the screen size, and nothing else", () => {
    const payload = buildFeedbackPayload({
      kind: "idea",
      text: "  Let me pin a match  ",
      route: `/competition?tab=strategy&orgId=${ORG}`,
      orgId: ORG,
      viewport: { width: 390.4, height: 844 },
    });
    expect(payload).toEqual({
      kind: "idea",
      description: "Let me pin a match",
      route: `/competition?tab=strategy&orgId=${ORG}`,
      orgId: ORG,
      clientInfo: { viewportWidth: 390, viewportHeight: 844 },
    });
    // The note promises "your note, the page you're on and your screen size": no browser string.
    expect(Object.keys(payload.clientInfo ?? {}).sort()).toEqual(["viewportHeight", "viewportWidth"]);
  });

  it("drops a team id that is not a real id rather than failing the whole note", () => {
    expect(buildFeedbackPayload({ kind: "bug", text: "x", route: "/help", orgId: "not-a-uuid", viewport: null }).orgId).toBeNull();
    expect(buildFeedbackPayload({ kind: "bug", text: "x", route: "/help", orgId: undefined, viewport: null }).orgId).toBeNull();
  });

  it("drops a page that is not a path inside the app, and a screen that was not measured", () => {
    const payload = buildFeedbackPayload({ kind: "bug", text: "x", route: "https://evil.example/", orgId: null, viewport: { width: 0, height: 0 } });
    expect(payload.route).toBeNull();
    expect(payload.clientInfo).toBeNull();
  });

  it("never sends more than the note can hold", () => {
    expect(buildFeedbackPayload({ kind: "bug", text: "x".repeat(6000), route: null, orgId: null, viewport: null }).description.length).toBe(5000);
  });
});

describe("feedbackErrorMessage", () => {
  it("says the same plain thing when nothing got through", () => {
    expect(feedbackErrorMessage(0)).toBe("Not sent. Check your connection and try again.");
    expect(FEEDBACK_NOT_SENT).toBe(feedbackErrorMessage(0));
  });

  it("is one sentence the person can act on, never what the server said", () => {
    for (const status of [400, 401, 403, 413, 429, 500, 503]) {
      const message = feedbackErrorMessage(status);
      expect(message.length, String(status)).toBeGreaterThan(20);
      expect(message, String(status)).not.toMatch(/internal|exception|sql|stack|undefined/i);
    }
    expect(feedbackErrorMessage(401)).toMatch(/sign in again/i);
    expect(feedbackErrorMessage(429)).toMatch(/few minutes/i);
  });
});

describe("sendFeedback", () => {
  const payload = buildFeedbackPayload({ kind: "bug", text: "It froze", route: "/help", orgId: null, viewport: null });

  it("posts the note as JSON and reports success", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    expect(await sendFeedback(payload, fetchImpl as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/feedback/bug");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: "bug", description: "It froze" });
  });

  it("turns a refusal into a sentence and keeps the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429 }));
    const result = await sendFeedback(payload, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, status: 429, message: feedbackErrorMessage(429) });
  });

  it("treats a dropped connection as 'not sent'", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendFeedback(payload, fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      status: 0,
      message: "Not sent. Check your connection and try again.",
    });
  });

  it("treats a timeout the same way", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await sendFeedback(payload, fetchImpl as unknown as typeof fetch, 20);
    expect(result).toEqual({ ok: false, status: 0, message: FEEDBACK_NOT_SENT });
  });
});
