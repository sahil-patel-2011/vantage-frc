import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoleOnboardingView } from "../../lib/role-onboarding/types";
import { homeNowFromWidgets, homeSetupSurfaces, type HomeNowAction } from "./dashboard-home-model";
import { sameHomeDestination } from "./dashboard-overview-model";
import { DashboardNowCard } from "./dashboard-now-card";
import { FirstWeekCard, setupHeroFrom } from "./first-week-card";

/*
  BUG-2: an owner at "3 of 4 done" saw no setup steps on Home. The hero was computed and then
  passed as null, and the first-week card stepped aside because the hero existed. Home now has
  exactly one setup surface while setup is open, and none once it is done.
*/

const check = (key: string, label: string, done: boolean, detail = "") => ({ key, label, detail, href: `/${key}`, done, completedAt: null });

function ownerView(done: string[]): RoleOnboardingView {
  const setupChecks = [
    check("invite", "Invite your team", done.includes("invite"), "Add students and mentors by email. Ticks once you send the first invite."),
    check("event", "Pick your event", done.includes("event")),
    check("scouting", "Set up your scouting form", done.includes("scouting")),
    check("calendar", "Add your first practice", done.includes("calendar"), "So students know when to show up."),
  ];
  const welcome = [check("read_knowledge", "Skim Team Knowledge", false)];
  return {
    status: "live",
    orgId: "org-1",
    orgName: "Team 6925",
    teamRole: "owner",
    crewRole: null,
    roleDescription: null,
    primaryFocus: "competition",
    subteamNames: [],
    doneCount: setupChecks.filter((c) => c.done).length,
    totalCount: setupChecks.length + welcome.length,
    tracks: [
      { key: "team_setup", title: "Set up your team", summary: "", source: "role", reason: "", dismissed: false,
        doneCount: setupChecks.filter((c) => c.done).length, totalCount: setupChecks.length, checks: setupChecks },
      { key: "welcome", title: "Welcome", summary: "", source: "welcome", reason: "", dismissed: false,
        doneCount: 0, totalCount: welcome.length, checks: welcome },
    ],
  };
}

const quiet: HomeNowAction = homeNowFromWidgets({ orgId: "org-1", widgets: {}, loaded: true });
const practice: HomeNowAction = { title: "Build night", detail: "Today at 6 PM", href: "/team?tab=calendar", cta: "Open Calendar" };
const noop = async () => undefined;

function renderFirstWeek(view: RoleOnboardingView, setupHere: boolean) {
  return renderToStaticMarkup(createElement(FirstWeekCard, { orgId: "org-1", view, busy: null, post: noop, setupHere }));
}
function renderNow(now: HomeNowAction, view: RoleOnboardingView | null) {
  return renderToStaticMarkup(createElement(DashboardNowCard, { now, setupHero: setupHeroFrom(view), loaded: true, orgId: "org-1", editing: false }));
}
const primaries = (html: string) => html.match(/is-primary/g)?.length ?? 0;

describe("homeSetupSurfaces: one setup surface while setup is open", () => {
  const base = { orgId: "org-1", setupOpen: true, nowQuiet: true, matchCardLeads: false, sharedSetupPrompt: false };

  it("puts the next setup step in the hero when nothing more pressing is on", () => {
    expect(homeSetupSurfaces(base)).toEqual({ setup: "now", nowCard: true, setupBannerAllowed: false });
  });

  it("keeps the hero for setup when the task card already shows the tasks", () => {
    expect(homeSetupSurfaces({ ...base, nowQuiet: false, taskCardLeads: true })).toMatchObject({ setup: "now", nowCard: true });
  });

  it("moves setup to its own card when a practice, duty or match leads", () => {
    expect(homeSetupSurfaces({ ...base, nowQuiet: false })).toMatchObject({ setup: "card", nowCard: true });
    // The Next match card leads: no hero at all, and setup still waits below.
    expect(homeSetupSurfaces({ ...base, nowQuiet: false, matchCardLeads: true })).toMatchObject({ setup: "card", nowCard: false });
  });

  it("keeps the competition prompt off while the checklist (with Pick your event) is up", () => {
    expect(homeSetupSurfaces({ ...base, sharedSetupPrompt: true })).toMatchObject({ setup: "now", nowCard: true, setupBannerAllowed: false });
  });

  it("shows nothing setup-shaped once setup is done, and the old rules come back", () => {
    expect(homeSetupSurfaces({ ...base, setupOpen: false })).toEqual({ setup: null, nowCard: true, setupBannerAllowed: true });
    // A quiet card stays off when the competition prompt is the thing to do.
    expect(homeSetupSurfaces({ ...base, setupOpen: false, sharedSetupPrompt: true }).nowCard).toBe(false);
    expect(homeSetupSurfaces({ ...base, setupOpen: false, nowQuiet: false, taskCardLeads: true }).nowCard).toBe(false);
    expect(homeSetupSurfaces({ ...base, orgId: "" })).toMatchObject({ setup: null, nowCard: false });
  });
});

describe("Home renders the setup steps (3 of 4 done, practice open)", () => {
  const view = ownerView(["invite", "event", "scouting"]);

  it("shows the hero with one primary: the next unfinished step", () => {
    const html = renderNow(quiet, view);
    expect(html).toContain("Add your first practice");
    expect(html).toContain("3 of 4 done");
    expect(html).toContain('data-testid="dash-now-cta"');
    expect(html).toContain("Add practice");
    expect(primaries(html)).toBe(1);
    // The next step is named in the list, not linked a second time beside its own button.
    expect(html).toContain('aria-current="step"');
    expect(html.match(/href="\/calendar\?orgId=org-1"/g)).toHaveLength(1);
    // Steps after it stay links to where they get done.
    expect(renderNow(quiet, ownerView(["event"]))).toContain('href="/scouting?orgId=org-1"');
    // The first-week card steps aside rather than repeat it.
    expect(renderFirstWeek(view, false)).toBe("");
  });

  it("shows the checklist as its own card, button secondary, when something else leads", () => {
    const html = renderFirstWeek(view, true);
    expect(html).toContain('data-testid="dash-team-setup"');
    expect(html).toContain("Add your first practice");
    expect(html).toContain("3 of 4 done");
    expect(primaries(html)).toBe(0);
    expect(html).toContain("app-button secondary");
    // And the hero is about the practice, not setup.
    expect(renderNow(practice, null)).not.toContain("3 of 4 done");
  });

  it("disappears once the last step is done, leaving the first-week list", () => {
    const done = ownerView(["invite", "event", "scouting", "calendar"]);
    expect(setupHeroFrom(done)).toBeNull();
    expect(renderNow(quiet, done)).not.toContain("of 4 done");
    const html = renderFirstWeek(done, true);
    expect(html).not.toContain("dash-team-setup");
    expect(html).toContain("Your first week");
    expect(html).toContain("Skim Team Knowledge");
  });
});

describe("Home shortcuts and the Now card read real data", () => {
  it("treats the form builder's two addresses as one destination", () => {
    expect(sameHomeDestination("/scouting/forms", "/competition?tab=forms&orgId=org-1")).toBe(true);
    expect(sameHomeDestination("/scouting/forms", "/competition?tab=scouting&orgId=org-1")).toBe(false);
  });

  it("says a task is yours from the snapshot's mineOpen count", () => {
    const now = homeNowFromWidgets({ orgId: "org-1", widgets: { t: { type: "team_todos", data: { open: 1, mineOpen: 1 } } } });
    expect(now.title).toBe("One task assigned to you");
    expect(homeNowFromWidgets({ orgId: "org-1", widgets: { t: { type: "team_todos", data: { open: 2, mineOpen: 0 } } } }).title).toBe("2 open team tasks");
  });
});
