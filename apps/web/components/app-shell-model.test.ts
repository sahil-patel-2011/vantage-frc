import { describe, expect, it } from "vitest";
import {
  accountInitialFor,
  accountLabelFor,
  activeIslandHref,
  backHrefForPath,
  filterVisibleNavGroups,
  formatMembershipLabel,
  formatRolePlanCue,
  islandTabIsActive,
  isHubRootPath,
  navResultRows,
  orgLabelFor,
  showBackForPath,
  shellTitleForPath,
  switchWorkspaceHrefFor,
  type Me,
} from "./app-shell-model";

describe("formatMembershipLabel", () => {
  it("joins team number and name", () => {
    expect(formatMembershipLabel({ orgId: "a", teamNumber: 6925, orgName: "Vantage" })).toBe(
      "Team 6925 · Vantage",
    );
  });

  it("falls back to Your team when both are missing", () => {
    expect(formatMembershipLabel({ orgId: "a" })).toBe("Your team");
  });
});

describe("formatRolePlanCue", () => {
  it("joins role and paid plan", () => {
    expect(formatRolePlanCue("mentor", "Pro", true)).toBe("mentor · Pro");
  });

  it("labels an unpaid plan as a plan", () => {
    expect(formatRolePlanCue(null, "Starter", false)).toBe("Starter plan");
  });

  it("falls back to Your team", () => {
    expect(formatRolePlanCue(null, null, false)).toBe("Your team");
  });
});

describe("islandTabIsActive", () => {
  it("lights Home for / and /dashboard", () => {
    expect(islandTabIsActive("/dashboard", "", "/dashboard")).toBe(true);
    expect(islandTabIsActive("/", "", "/dashboard")).toBe(true);
  });

  it("requires the tab query when the href has one", () => {
    expect(islandTabIsActive("/competition", "?tab=scouting", "/competition?tab=scouting")).toBe(true);
    expect(islandTabIsActive("/competition", "?tab=strategy", "/competition?tab=scouting")).toBe(false);
    expect(islandTabIsActive("/competition", "", "/competition?tab=scouting")).toBe(false);
  });

  it("treats /calendar as the team calendar island tab", () => {
    expect(islandTabIsActive("/calendar", "", "/team/calendar")).toBe(true);
  });
});

describe("activeIslandHref", () => {
  it("prefers a query match over a path-only tab", () => {
    const href = activeIslandHref("/competition", "?tab=scouting", [
      { href: "/competition" },
      { href: "/competition?tab=scouting" },
    ]);
    expect(href).toBe("/competition?tab=scouting");
  });
});

describe("account chrome", () => {
  it("uses the given name for the avatar glyph when the listed name is brand-like", () => {
    const me: Me = { firstName: "Sahil", name: "Vantage", email: "sahil@example.com" };
    expect(accountLabelFor(me)).toBe("Vantage");
    expect(accountInitialFor(me)).toBe("S");
  });

  it("uses the email initial when the only name is brand-like", () => {
    expect(accountInitialFor({ name: "Team 6925", email: "coach@example.com" })).toBe("C");
  });

  it("prints Team N · name", () => {
    expect(orgLabelFor({ teamNumber: 254, orgName: "Cheesy Poofs" }, "org")).toBe(
      "Team 254 · Cheesy Poofs",
    );
  });

  it("says No team selected with no org", () => {
    expect(orgLabelFor({}, "")).toBe("No team selected");
  });
});

describe("hub chrome paths", () => {
  it("hides Back on hub roots", () => {
    expect(isHubRootPath("/competition")).toBe(true);
    expect(showBackForPath("/competition")).toBe(false);
    expect(showBackForPath("/account")).toBe(true);
    expect(showBackForPath("/docs/scouting")).toBe(true);
  });

  it("sends Account back to Home and nested docs to the manual", () => {
    expect(backHrefForPath("/account", null)).toBe("/dashboard");
    expect(backHrefForPath("/docs/scouting", null)).toBe("/docs");
    expect(backHrefForPath("/team/admin", "org-1")).toContain("/team");
  });

  it("titles Account / App manual when the nav catalog has no match", () => {
    expect(shellTitleForPath("/account")).toBe("Account");
    expect(shellTitleForPath("/docs")).toBe("App manual");
    expect(shellTitleForPath("/support")).toBe("Support");
  });

  it("lands org-exempt chrome on Manage teams when switching teams", () => {
    expect(switchWorkspaceHrefFor("/account", "", "org-2")).toContain("/workspace");
    expect(switchWorkspaceHrefFor("/competition", "?tab=scouting", "org-2")).toContain("orgId=org-2");
  });
});

describe("nav helpers", () => {
  it("drops empty groups after access filtering", () => {
    const groups = filterVisibleNavGroups(
      [
        {
          label: "Home",
          tone: "var(--tone-blue)",
          toneBg: "",
          icon: "home",
          items: [{ href: "/dashboard", label: "Home", icon: "home" }],
        },
        {
          label: "Business",
          tone: "var(--tone-blue)",
          toneBg: "",
          icon: "clipboard",
          items: [{ href: "/business", label: "Business", icon: "clipboard" }],
        },
      ],
      (href) => href !== "/business",
    );
    expect(groups.map((group) => group.label)).toEqual(["Home"]);
  });

  it("stacks command hits above data hits so the cursor does not reshuffle", () => {
    const rows = navResultRows(
      [{ id: "a", label: "Scouting", context: "Competition", href: "/scouting", kind: "destination", keywords: [], score: 1 }],
      [{ title: "Match notes", href: "/notes/1" }],
    );
    expect(rows[0]?.kind).toBe("command");
    expect(rows[1]?.kind).toBe("data");
  });
});
