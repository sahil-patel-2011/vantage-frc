import { describe, expect, it } from "vitest";
import {
  attachOfficialRunToChatBody,
  lastUserPrompt,
  OFFICIAL_FREEBUFF_SYSTEM_OPENING,
  officialAgentIdForModel,
  officialAgentRunsUrl,
  officialChatUrl,
  officialCredentialsPath,
  officialSessionUrl,
  openaiCompletionFromText,
  parseOfficialCredentials,
  toOfficialFreebuffWireModel,
} from "../src/official-freebuff-session";

describe("official Freebuff login files", () => {
  it("reads the official CLI credentials path, not a shared dump", () => {
    expect(officialCredentialsPath("/home/vantage")).toBe("/home/vantage/.config/manicode/credentials.json");
  });

  it("parses the official credentials shape without leaking a missing token", () => {
    expect(parseOfficialCredentials("{}")).toBeNull();
    expect(parseOfficialCredentials("{not json")).toBeNull();
    const parsed = parseOfficialCredentials(
      JSON.stringify({ default: { name: "Sahil", email: "a@b.c", authToken: "cb_test" } }),
    );
    expect(parsed?.authToken).toBe("cb_test");
    expect(parsed?.name).toBe("Sahil");
  });

  it("talks to official Freebuff session and chat URLs", () => {
    expect(officialSessionUrl()).toBe("https://www.codebuff.com/api/v1/freebuff/session");
    expect(officialChatUrl()).toBe("https://www.codebuff.com/api/v1/chat/completions");
    expect(officialAgentRunsUrl()).toBe("https://www.codebuff.com/api/v1/agent-runs");
    const withRun = JSON.parse(
      attachOfficialRunToChatBody(
        JSON.stringify({
          model: "glm/glm-5.3-flash",
          messages: [{ role: "system", content: "Coding folder for organization aaa only." }],
        }),
        {
          runId: "run-1",
          instanceId: "inst-1",
          clientId: "fp-1",
          model: "z-ai/glm-5.3-flash",
        },
      ),
    ) as {
      runId: string;
      model: string;
      costMode: string;
      messages: Array<{ role: string; content: string }>;
      codebuff_metadata: {
        run_id: string;
        freebuff_instance_id: string;
        cost_mode: string;
        client_id: string;
      };
    };
    expect(withRun.runId).toBe("run-1");
    expect(withRun.model).toBe("z-ai/glm-5.3-flash");
    expect(withRun.costMode).toBe("free");
    expect(withRun.codebuff_metadata.freebuff_instance_id).toBe("inst-1");
    expect(withRun.codebuff_metadata.cost_mode).toBe("free");
    expect(withRun.codebuff_metadata.client_id).toBe("fp-1");
    expect(withRun.messages[0]?.content.startsWith(OFFICIAL_FREEBUFF_SYSTEM_OPENING)).toBe(true);
    expect(withRun.messages[0]?.content).toContain("Coding folder for organization aaa only.");
    expect(toOfficialFreebuffWireModel("glm/glm-5.3-flash")).toBe("z-ai/glm-5.3-flash");
    expect(toOfficialFreebuffWireModel("mimo/mimo-2.5")).toBe("mimo/mimo-v2.5");
    expect(officialAgentIdForModel("mimo/mimo-v2.5")).toBe("base3-free-mimo");
    expect(officialAgentIdForModel("glm/glm-5.3-flash")).toBe("base3-free-glm-5-3-flash");
    expect(officialAgentIdForModel("z-ai/glm-5.3-flash")).toBe("base3-free-glm-5-3-flash");
  });

  it("reuses a live official session instead of POSTing a second model", async () => {
    const { admitOfficialFreebuffSession } = await import("../src/official-freebuff-session");
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      return new Response(
        JSON.stringify({
          status: "active",
          instanceId: "live-1",
          model: "mimo/mimo-v2.5",
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const admitted = await admitOfficialFreebuffSession({
      token: "cb_test",
      model: "glm/glm-5.3-flash",
      fetchImpl,
    });
    expect(admitted).toEqual({
      ok: true,
      status: "active",
      instanceId: "live-1",
      model: "mimo/mimo-v2.5",
    });
    expect(calls).toEqual(["GET https://www.codebuff.com/api/v1/freebuff/session"]);
  });
});

describe("official chat body helpers", () => {
  it("takes the last user turn and wraps a completion", () => {
    expect(
      lastUserPrompt(
        JSON.stringify({
          messages: [
            { role: "system", content: "folder note" },
            { role: "user", content: "first" },
            { role: "user", content: "scout team 6925" },
          ],
        }),
      ),
    ).toBe("scout team 6925");
    const completion = JSON.parse(openaiCompletionFromText("glm/glm-5.3-flash", "hello")) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
    };
    expect(completion.model).toBe("glm/glm-5.3-flash");
    expect(completion.choices[0]?.message.content).toBe("hello");
  });
});
