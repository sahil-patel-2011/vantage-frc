import { describe, expect, it } from "vitest";
import {
  marketingFooterAccountLink,
  marketingHeaderLinks,
  marketingHeroLinks,
} from "./account-links";

describe("marketing account links", () => {
  it("sends a guest to sign in and the waitlist", () => {
    expect(marketingHeaderLinks(false).map((link) => link.label)).toEqual([
      "Sign in",
      "Join waitlist",
    ]);
    expect(marketingHeaderLinks(false).find((link) => link.primary)?.href).toBe("/#waitlist");
    expect(marketingHeroLinks(false).map((link) => link.label)).toEqual([
      "Join the waitlist",
      "Already invited? Sign in",
    ]);
    expect(marketingHeroLinks(false).filter((link) => link.primary)).toHaveLength(1);
    expect(marketingFooterAccountLink(false)).toEqual({ href: "/signin", label: "Sign in" });
  });

  it("sends a signed-in member to the team home", () => {
    for (const links of [marketingHeaderLinks(true), marketingHeroLinks(true)]) {
      expect(links).toEqual([{ href: "/dashboard", label: "Open your team", primary: true }]);
    }
    expect(marketingFooterAccountLink(true)).toEqual({
      href: "/dashboard",
      label: "Open your team",
    });
  });
});
