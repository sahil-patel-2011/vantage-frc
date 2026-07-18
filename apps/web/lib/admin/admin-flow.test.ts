import { describe, expect, it } from "vitest";
import {
  ADMIN_RELATED_INCLUDE,
  adminEmptyCopy,
  adminNextActions,
  adminOrgMetric,
  adminProvisionHref,
  adminRelatedLinks,
  classifyAdminShell,
  formatAdminOrgLabel,
} from "./admin-flow";

describe("adminRelatedLinks", () => {
  it("builds Plans / Support / Releases / Waitlist cross-links", () => {
    const links = adminRelatedLinks({ include: [...ADMIN_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["waitlist", "plans", "support", "releases"]);
    expect(links.find((l) => l.id === "plans")?.href).toBe("/admin/plans");
    expect(links.find((l) => l.id === "support")?.href).toBe("/admin/support");
    expect(links.find((l) => l.id === "releases")?.href).toBe("/admin/releases");
    expect(links.find((l) => l.id === "waitlist")?.href).toBe("/admin/waitlist");
  });

  it("excludes active and respects include", () => {
    const links = adminRelatedLinks({
      active: "plans",
      include: ["plans", "support", "releases"],
    });
    expect(links.map((l) => l.id)).toEqual(["support", "releases"]);
  });

  it("never uses DEMO labels", () => {
    const links = adminRelatedLinks();
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    expect(ADMIN_RELATED_INCLUDE).toEqual(["plans", "support", "releases", "waitlist"]);
  });
});

describe("adminProvisionHref", () => {
  it("encodes owner email and team number without JSX template bugs", () => {
    expect(adminProvisionHref({ ownerEmail: "coach@example.com", teamNumber: 254 })).toBe(
      "/admin?ownerEmail=coach%40example.com&teamNumber=254",
    );
  });

  it("returns plain /admin when both fields are blank", () => {
    expect(adminProvisionHref({ ownerEmail: "  ", teamNumber: "" })).toBe("/admin");
  });
});

describe("formatAdminOrgLabel / adminOrgMetric", () => {
  it("joins real team identity without inventing DEMO names", () => {
    expect(
      formatAdminOrgLabel({
        name: "Cheesy Poofs",
        slug: "254",
        teamNumber: 254,
        ownerEmail: "owner@example.com",
      }),
    ).toBe("#254 · Cheesy Poofs · 254 · owner@example.com");
  });

  it("keeps metrics blank until loaded and never fabricates counts", () => {
    expect(adminOrgMetric(null, false)).toBe("…");
    expect(adminOrgMetric(3, true)).toBe("3");
    expect(adminOrgMetric(-1, true)).toBe("0");
  });
});

describe("classifyAdminShell", () => {
  it("maps HTTP outcomes to Soft-UI shells without inventing ready data", () => {
    expect(classifyAdminShell({ loading: true, organizationCount: 0 })).toBe("loading");
    expect(classifyAdminShell({ loading: false, status: 401, organizationCount: 0 })).toBe(
      "auth_required",
    );
    expect(classifyAdminShell({ loading: false, status: 404, organizationCount: 0 })).toBe(
      "forbidden",
    );
    expect(classifyAdminShell({ loading: false, status: 503, organizationCount: 0 })).toBe(
      "setup_required",
    );
    expect(classifyAdminShell({ loading: false, organizationCount: 0 })).toBe("empty");
    expect(classifyAdminShell({ loading: false, organizationCount: 2 })).toBe("ready");
  });
});

describe("adminEmptyCopy / adminNextActions", () => {
  it("clarifies empty / setup / forbidden copy", () => {
    expect(adminEmptyCopy("empty").badge).toBe("Empty");
    expect(adminEmptyCopy("setup_required").badge).toBe("setup_required");
    expect(adminEmptyCopy("forbidden").badge).toBe("Forbidden");
    expect(adminEmptyCopy("forbidden").description).toMatch(/platform_admins/i);
    expect(adminEmptyCopy("empty").description).not.toMatch(/demo/i);
  });

  it("points empty hub at waitlist + plans/support/releases", () => {
    const actions = adminNextActions("empty");
    expect(actions[0]?.id).toBe("waitlist");
    expect(actions.map((a) => a.id)).toEqual(["waitlist", "plans", "support", "releases"]);
    expect(actions.every((a) => !/demo/i.test(a.label))).toBe(true);
  });

  it("keeps forbidden from advertising DEMO admin metrics paths", () => {
    const actions = adminNextActions("forbidden");
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.every((a) => !a.href.startsWith("/admin/plans"))).toBe(true);
  });
});
