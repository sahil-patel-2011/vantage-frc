import { describe, expect, it } from "vitest";
import { ChatProviderResolutionError } from "@vantage/agent";
import { AI_OFF_MESSAGE, failMeteredAi } from "./metered-ai-fail";

describe("failMeteredAi", () => {
  it("returns setup_required when no provider key is configured", async () => {
    const response = failMeteredAi(
      new ChatProviderResolutionError(
        "No AI provider key is configured for this organization. Free workspaces require a BYOK or custom OpenAI/Anthropic provider under Team Admin.",
      ),
      "Agent request failed",
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      code?: string;
      status?: string;
      steps?: Array<{ id: string }>;
    };
    expect(body.code).toBe("setup_required");
    expect(body.status).toBe("setup_required");
    expect(body.steps?.map((step) => step.id)).toEqual(["keys", "budgets", "governance"]);
  });

  it("tells the team AI is off in plain words, never the router's environment variable names", async () => {
    for (const error of [
      new ChatProviderResolutionError(
        "No AI provider key is configured for this organization. Free workspaces use the platform OpenRouter free pool when OPENROUTER_API_KEY is set, the AI Horde volunteer swarm when AI_HORDE_POOL is on.",
      ),
      new Error("Free organizations must configure a BYO AI key"),
    ]) {
      const response = failMeteredAi(error, "Brief failed");
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error?: string; message?: string; code?: string };
      expect(body.code).toBe("setup_required");
      expect(body.message).toBe(AI_OFF_MESSAGE);
      expect(JSON.stringify(body)).not.toMatch(/OPENROUTER|AI_HORDE|BYO/);
    }
  });

  it("keeps a key problem the team can fix in its own words", async () => {
    const response = failMeteredAi(new ChatProviderResolutionError("Your OpenAI API key was rejected."), "failed");
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("Your OpenAI API key was rejected.");
  });
});
