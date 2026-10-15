import { describe, expect, it } from "vitest";
import { connectionMessage, connectionNextStep, refusedConnection } from "./use-ai-connection";

describe("Ask AI connection state", () => {
  it("uses the server's next step, and falls back on the reason for an older server", () => {
    expect(connectionNextStep({ configured: false, reason: "team_connection_required", nextStep: "ask_owner" })).toBe("ask_owner");
    expect(connectionNextStep({ configured: false, reason: "check_unavailable" })).toBe("retry");
    expect(connectionNextStep({ configured: false, reason: "usage_cap" })).toBe("settings");
    expect(connectionNextStep({ configured: false, reason: "missing_context:billing_account" })).toBe("none");
    expect(connectionNextStep({ configured: false, reason: "no_model_provider" })).toBe("connect");
  });

  it("a refused send never leaves Send enabled", () => {
    const sent = { configured: false, reason: "team_connection_required", message: "This team doesn't have its own AI connection yet, so Ask AI can't answer.", nextStep: "team" as const };
    expect(refusedConnection({ aiConnection: sent })).toEqual(sent);
    // A server that says "configured" while refusing the turn is not believed.
    expect(refusedConnection({ aiConnection: { configured: true, reason: null }, message: "No usable AI connection." })).toMatchObject({ configured: false, message: "No usable AI connection.", nextStep: "settings" });
    expect(refusedConnection({ error: "Not sent." })).toMatchObject({ configured: false, message: "Not sent." });
  });

  it("always has a plain sentence to show", () => {
    expect(connectionMessage({ configured: false, reason: "no_model_provider" })).toBe("AI isn't connected for this team yet.");
    expect(connectionMessage({ configured: false, reason: "provider_unavailable" })).toMatch(/Check its settings/);
  });
});
