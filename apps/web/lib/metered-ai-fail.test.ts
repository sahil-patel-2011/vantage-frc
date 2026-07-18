import { describe, expect, it } from "vitest";
import { ChatProviderResolutionError } from "@vantage/agent";
import { failMeteredAi } from "./metered-ai-fail";

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
});
