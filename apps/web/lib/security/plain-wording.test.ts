import { describe, expect, it } from "vitest";
import { plainWording, publicErrorMessage } from "./public-error";

describe("plain wording on the way to the page", () => {
  it("rewords code-shaped refusals in the app's own words", () => {
    expect(plainWording("Organization access denied")).toBe("You're not on this team.");
    expect(plainWording("Organization membership required")).toBe("You're not on this team.");
    expect(plainWording("Organization administrator access required")).toBe("Only the team's owners and admins can do this.");
    expect(plainWording("orgId is required")).toBe("Choose your team first.");
    expect(publicErrorMessage(new Error("orgId is required"), "fallback")).toBe("Choose your team first.");
    expect(plainWording("Pick a match first")).toBe("Pick a match first");
  });

  it("never passes a migration number or a database update to the page", () => {
    expect(publicErrorMessage(new Error("Lead sign-offs need a database update (0719)."), "Not available yet.")).toBe("Not available yet.");
    expect(publicErrorMessage(new Error("Needs migration 0733"), "Not available yet.")).toBe("Not available yet.");
  });
});
