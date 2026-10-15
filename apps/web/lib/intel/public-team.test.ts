import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicTeam } from "./public-team";

describe("fetchPublicTeam", () => {
  const saved = process.env.TBA_AUTH_KEY;
  beforeEach(() => {
    process.env.TBA_AUTH_KEY = "test-key";
  });
  afterEach(() => {
    process.env.TBA_AUTH_KEY = saved;
  });

  it("returns the team's public profile and a link to its page", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ team_number: 254, nickname: "The Cheesy Poofs", city: "San Jose", state_prov: "California", country: "USA", rookie_year: 1999 })),
    );
    const team = await fetchPublicTeam(254, fetcher as unknown as typeof fetch);
    expect(team).toEqual({
      teamNumber: 254,
      nickname: "The Cheesy Poofs",
      city: "San Jose",
      stateProv: "California",
      country: "USA",
      rookieYear: 1999,
      tbaHref: "https://www.thebluealliance.com/team/254",
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://www.thebluealliance.com/api/v3/team/frc254");
  });

  it("is null, never an error, when TBA has no such team, fails, or has no key", async () => {
    expect(await fetchPublicTeam(99998, (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchPublicTeam(254, (async () => { throw new TypeError("down"); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchPublicTeam(0, vi.fn() as unknown as typeof fetch)).toBeNull();
    delete process.env.TBA_AUTH_KEY;
    delete process.env.TBA_API_KEY;
    const fetcher = vi.fn();
    expect(await fetchPublicTeam(254, fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
