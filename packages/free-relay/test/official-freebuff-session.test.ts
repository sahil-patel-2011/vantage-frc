import { describe, expect, it } from "vitest";
import {
  lastUserPrompt,
  officialChatUrl,
  officialCredentialsPath,
  officialSessionUrl,
  openaiCompletionFromText,
  parseOfficialCredentials,
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
    expect(officialSessionUrl()).toBe("https://www.freebuff.com/api/v1/freebuff/session");
    expect(officialChatUrl()).toBe("https://www.freebuff.com/api/v1/chat/completions");
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
