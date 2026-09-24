import { describe, expect, it } from "vitest";
import { teamFacingError } from "./team-facing-error";

describe("errors as a team reads them", () => {
  it("never shows server setting names", () => {
    const old =
      "TBA Read API key is not configured. Create one at thebluealliance.com → Account → Read API Keys, then either set TBA_AUTH_KEY (or TBA_API_KEY) in your deployment environment (Vercel → Project → Settings → Environment Variables) and redeploy";
    expect(teamFacingError(old, "fallback")).toBe("Match data isn't connected yet. An owner can connect it on Team → Data");
    expect(teamFacingError("DATABASE_URL missing", "Something went wrong")).toBe("Something went wrong");
  });
  it("keeps ordinary messages and fills in empty ones", () => {
    expect(teamFacingError("Statbotics did not answer", "x")).toBe("Statbotics did not answer");
    expect(teamFacingError(null, "neither source answered")).toBe("neither source answered");
  });
});
