import { describe, expect, it } from "vitest";
import { securityErrorResponse } from "./request";

describe("securityErrorResponse", () => {
  it("answers 403 when the failure is a role check", async () => {
    const response = securityErrorResponse(
      new Error("Organization administrator access required"),
      "Request failed",
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization administrator access required",
    });
  });

  it("keeps a generic failure at 400", () => {
    const response = securityErrorResponse(new Error("Could not save"), "Request failed");
    expect(response.status).toBe(400);
  });
});