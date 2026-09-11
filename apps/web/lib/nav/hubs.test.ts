import { describe, expect, it } from "vitest";
import {
  hubById,
  hubFeaturedMoreTabs,
  hubHref,
  hubLegacyHref,
  hubMoreTabs,
  hubNestedTabs,
  hubPrimaryTabs,
  hubStripTabs,
  hubWorkbenchHref,
  hubWorkbenchId,
  isHubTab,
  NAV_HUBS,
  PRODUCT_HUBS,
} from "./hubs";

describe("product hubs", () => {
  it("defines six hub pages but only four primary workspaces", () => {
    // Every hub page still exists and every /hub?tab= URL still resolves.
    expect(PRODUCT_HUBS.map((hub) => hub.id)).toEqual([
      "competition", "team", "business", "build", "ai", "media",
    ]);
    // The island, the All panel and the marketing page list only these.
    // Four plus Home is the whole top level (UI_DESIGN_RULES R1).
    expect(NAV_HUBS.map((hub) => hub.id)).toEqual(["competition", "team", "business", "build"]);
  });

  it("keeps every tool of a hidden hub reachable from a visible one or from Settings", () => {
    // Media → Business › Outreach. Each former Media workbench has a tool entry
    // under a visible hub pointing at the same route.
    const business = hubById("business");
    const outreach = hubNestedTabs(business, "evidence").map((tab) => tab.legacyHref);
    expect(outreach).toEqual(
      expect.arrayContaining(["/media?tab=calendar", "/media?tab=drafts", "/media?tab=reminders", "/media?tab=kit", "/media-library", "/impact"]),
    );
    // AI → Ask AI (top bar, /ai?tab=chat) for chat; written work under Team › Playbook;
    // code tools already under Build › Code; controls under Settings (settings-nav.ts).
    const playbook = hubNestedTabs(hubById("team"), "knowledge").map((tab) => tab.legacyHref);
    expect(playbook).toEqual(expect.arrayContaining(["/writer", "/decisions", "/season-report"]));
    const code = hubNestedTabs(hubById("build"), "code").map((tab) => tab.legacyHref);
    expect(code).toEqual(expect.arrayContaining(["/bugbot"]));
  });

  it("validates tabs and builds deep links", () => {
    const competition = hubById("competition");
    expect(isHubTab(competition, "scouting")).toBe(true);
    expect(isHubTab(competition, "not-a-real-tab")).toBe(false);
    expect(hubHref("/business", "orders", "org-1")).toBe("/business?tab=orders&orgId=org-1");
  });

  it("keeps a short workbench TabBar with inner tools instead of a More-tools dump", () => {
    for (const hub of PRODUCT_HUBS) {
      const workbenches = hubPrimaryTabs(hub);
      expect(workbenches.length).toBeGreaterThanOrEqual(3);
      expect(workbenches.length).toBeLessThanOrEqual(6);
      expect(workbenches.every((tab) => !tab.group)).toBe(true);
    }
  });

  it("nests Business money / sponsors / grants / outreach under four workbenches", () => {
    const business = hubById("business");
    expect(hubPrimaryTabs(business).map((tab) => tab.id)).toEqual([
      "overview",
      "finance",
      "sponsors",
      "grants",
      "evidence",
    ]);
    expect(hubNestedTabs(business, "finance").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["finance", "budget", "orders", "costs"]),
    );
    expect(hubMoreTabs(business).map((tab) => tab.id)).toContain("fundraisers");
    expect(hubMoreTabs(business).map((tab) => tab.id)).toContain("impact");
    expect(hubMoreTabs(business).map((tab) => tab.id)).not.toContain("media");
  });

  it("surfaces Media hub tabs for calendar, drafts, reminders, kit, and impact", () => {
    const media = hubById("media");
    expect(hubPrimaryTabs(media).map((tab) => tab.id)).toEqual([
      "calendar",
      "drafts",
      "reminders",
      "kit",
      "impact",
    ]);
    expect(media.tabs.find((tab) => tab.id === "kit")?.legacyHref).toBe("/media-kit");
    expect(media.tabs.find((tab) => tab.id === "media-library")?.legacyHref).toBe("/media-library");
    const library = media.tabs.find((tab) => tab.id === "media-library");
    expect(hubLegacyHref(library!, "org-1")).toBe("/media-library?orgId=org-1");
  });

  it("gives nested Media tools a standalone route so the hub can open them", () => {
    for (const tab of hubById("media").tabs.filter((entry) => entry.group)) {
      expect(tab.legacyHref, `media:${tab.id} nested without legacyHref`).toBeTruthy();
    }
  });

  it("keeps Team workbenches to calendar, chat, people, work, and playbook", () => {
    const team = hubById("team");
    expect(hubPrimaryTabs(team).map((tab) => tab.id)).toEqual([
      "calendar",
      "messages",
      "attendance",
      "todos",
      "knowledge",
    ]);
    expect(team.tabs.find((tab) => tab.id === "knowledge")?.label).toBe("Playbook");
    expect(hubNestedTabs(team, "todos").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["practice", "batteries", "fmea", "season-planning-workspace"]),
    );
    expect(team.tabs.find((tab) => tab.id === "todos")?.legacyHref).toBe("/todos");
  });

  it("keeps Build workbenches to kickoff, CAD, code, and robot", () => {
    const build = hubById("build");
    expect(hubPrimaryTabs(build).map((tab) => tab.id)).toEqual(["kickoff", "cad", "code", "fmea"]);
    expect(hubNestedTabs(build, "fmea").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["prototype", "batteries", "robot"]),
    );
    expect(hubNestedTabs(build, "cad").map((tab) => tab.id)).toContain("cad-change-radar");
    expect(hubNestedTabs(build, "code").map((tab) => tab.id)).toContain("bugbot");
  });

  it("keeps AI workbenches to chat, writer, agent, controls, and notes", () => {
    const ai = hubById("ai");
    expect(hubPrimaryTabs(ai).map((tab) => tab.id)).toEqual([
      "chat",
      "writer",
      "agent",
      "budgets",
      "decisions",
    ]);
    expect(hubNestedTabs(ai, "budgets").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["memory", "governance", "finance", "ai-keys"]),
    );
    expect(hubNestedTabs(ai, "decisions").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["decision-search", "season-report"]),
    );
  });

  it("resolves nested tools back to their workbench", () => {
    const competition = hubById("competition");
    expect(hubWorkbenchId(competition, "forms")).toBe("scouting");
    expect(hubWorkbenchId(competition, "pick-clock")).toBe("strategy");
    expect(hubWorkbenchId(competition, "command")).toBe("command");
    expect(hubPrimaryTabs(competition).map((tab) => tab.id)).toEqual([
      "command",
      "scouting",
      "strategy",
      "match-checklist",
    ]);
    expect(hubNestedTabs(competition, "command").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["command", "my-day"]),
    );
  });

  it("pins Alliance desk, Season planning, and AI keys as featured inner tools", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toEqual([
      // The one pre-match briefing is the drive team's front door on event day.
      "briefing",
      "alliance-selection-desk",
    ]);
    expect(hubFeaturedMoreTabs(hubById("team")).map((tab) => tab.id)).toContain(
      "season-planning-workspace",
    );
    expect(hubFeaturedMoreTabs(hubById("ai")).map((tab) => tab.id)).toEqual(["ai-keys"]);
  });

  it("links a nested tool back to its workbench, not to itself", () => {
    expect(hubWorkbenchHref("competition", "pick-clock", "org-1")).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(hubWorkbenchHref("build", "gearbox")).toBe("/build?tab=fmea");
  });

  it("returns a workbench root unchanged", () => {
    expect(hubWorkbenchHref("build", "cad")).toBe("/build?tab=cad");
    expect(hubWorkbenchHref("team", "knowledge", "org-2")).toBe("/team?tab=knowledge&orgId=org-2");
  });

  it("falls back to the hub default tab for an unknown tab id", () => {
    expect(hubWorkbenchHref("team", "not-a-real-tab")).toBe("/team?tab=calendar");
    expect(hubWorkbenchHref("business", "nope", "org-3")).toBe(
      "/business?tab=overview&orgId=org-3",
    );
  });

  it("never lists the same route twice inside one hub", () => {
    for (const hub of PRODUCT_HUBS) {
      const ids = hub.tabs.map((tab) => tab.id);
      expect(new Set(ids).size, `duplicate tab id in ${hub.id}`).toBe(ids.length);

      const hrefs = hub.tabs.map((tab) => tab.legacyHref).filter((href): href is string => Boolean(href));
      expect(new Set(hrefs).size, `duplicate legacyHref in ${hub.id}`).toBe(hrefs.length);
    }
  });

  it("points every nested tab at a real workbench root", () => {
    for (const hub of PRODUCT_HUBS) {
      const roots = new Set(hubPrimaryTabs(hub).map((tab) => tab.id));
      expect(roots.has(hub.defaultTab), `${hub.id} defaultTab is not a workbench`).toBe(true);
      for (const tab of hub.tabs.filter((entry) => entry.group)) {
        expect(roots.has(tab.group as string), `${hub.id}:${tab.id} -> ${tab.group}`).toBe(true);
        expect(hubWorkbenchId(hub, tab.id)).toBe(tab.group);
      }
    }
  });

  it("registers the previously unreachable routes so search and menus can find them", () => {
    const competition = hubById("competition");
    expect(hubNestedTabs(competition, "command").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["rankings", "schedule", "briefing"]),
    );
    expect(hubNestedTabs(competition, "strategy").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["intel", "dossier", "video"]),
    );
    expect(hubNestedTabs(competition, "match-checklist").map((tab) => tab.id)).toContain("pit");

    expect(hubNestedTabs(hubById("build"), "fmea").map((tab) => tab.id)).toEqual(
      expect.arrayContaining([
        "subsystems",
        "bringup",
        "reviews",
        "gearbox",
        "shooter-table",
        "weight-budget",
        "power-budget",
        // Distinct tools, not duplicates of their similarly-named neighbours:
        // /wiring is the CAN-bus map, /tuning the calibration log, /spares the
        // consumables inventory. Each was nearly redirected away as a "duplicate".
        "wiring-map",
        "tuning-log",
        "consumables",
      ]),
    );

    // …and the neighbours they were confused with keep their own distinct labels.
    const buildRobotLabels = hubNestedTabs(hubById("build"), "fmea").map((tab) => tab.label);
    expect(buildRobotLabels).toEqual(
      expect.arrayContaining(["Wiring check", "CAN-bus map", "Tuning advisor", "Tuning log"]),
    );

    const team = hubById("team");
    expect(hubNestedTabs(team, "todos").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["safety", "goals"]),
    );
    expect(hubNestedTabs(team, "knowledge").map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["notebook", "risks"]),
    );

    expect(hubNestedTabs(hubById("business"), "finance").map((tab) => tab.id)).toContain("vendors");
  });

  it("registers /training and /roles under Team › People", () => {
    const team = hubById("team");
    const people = hubNestedTabs(team, "attendance");
    const training = people.find((tab) => tab.id === "training");
    expect(training?.label).toBe("Training matrix");
    expect(training?.legacyHref).toBe("/training");
    const roles = people.find((tab) => tab.id === "roles");
    expect(roles?.label).toBe("Season roles");
    expect(roles?.legacyHref).toBe("/roles");
    expect(hubWorkbenchId(team, "training")).toBe("attendance");
    expect(hubWorkbenchId(team, "roles")).toBe("attendance");
  });

  it("registers this wave's routes under the workbench that owns the job", () => {
    const expected: Array<[Parameters<typeof hubById>[0], string, string, string]> = [
      ["team", "attendance", "parents", "/parents"],
      ["team", "attendance", "presence", "/presence"],
      ["team", "attendance", "learning", "/learning"],
      ["team", "knowledge", "knowledge-drafts", "/knowledge-drafts"],
      ["build", "cad", "cad-vault", "/cad-vault"],
      ["build", "fmea", "manufacturing", "/manufacturing"],
      ["build", "fmea", "print-farm", "/print-farm"],
      ["competition", "command", "event-readiness", "/event-readiness"],
    ];
    for (const [hubId, workbench, tabId, href] of expected) {
      const hub = hubById(hubId);
      const tab = hub.tabs.find((entry) => entry.id === tabId);
      expect(tab?.legacyHref, `${hubId}:${tabId}`).toBe(href);
      expect(hubWorkbenchId(hub, tabId), `${hubId}:${tabId} workbench`).toBe(workbench);
      expect(hubNestedTabs(hub, workbench).map((entry) => entry.id)).toContain(tabId);
    }
  });

  it("keeps scout meta jobs reachable but off the Scouting tool strip", () => {
    const competition = hubById("competition");
    const hidden = [
      "scout-accuracy",
      "scout-crossval",
      "scout-disagreements",
      "scout-data-impact",
      "scout-assisted-count",
      "scout-schema-negotiate",
      "scouting-heat-signals",
      "scouting-schema-ab",
    ];
    const nested = hubNestedTabs(competition, "scouting").map((tab) => tab.id);
    for (const id of hidden) {
      expect(nested, id).toContain(id);
      expect(isHubTab(competition, id)).toBe(true);
    }
    expect(hubStripTabs(competition, "scouting").map((tab) => tab.id)).toEqual([
      "scouting",
      "forms",
      "scout-coverage-live",
      "shift-balancer",
      "scout-p2p-relay",
      "scout-training-mode",
      "scout-field-budget",
      "data-quality-scorecard",
    ]);
    expect(competition.tabs.find((tab) => tab.id === "scout-p2p-relay")?.label).toBe("Pit link");
    expect(competition.tabs.find((tab) => tab.id === "scout-field-budget")?.label).toBe(
      "Field value",
    );
    expect(hubStripTabs(competition, "scouting", "scout-accuracy").map((tab) => tab.id)).toContain(
      "scout-accuracy",
    );
  });

  it("keeps the build-season board off the Work tool strip", () => {
    const team = hubById("team");
    expect(hubNestedTabs(team, "todos").map((tab) => tab.id)).toContain("task-board");
    expect(isHubTab(team, "task-board")).toBe(true);
    expect(team.tabs.find((tab) => tab.id === "task-board")?.legacyHref).toBe("/tasks");
    expect(hubStripTabs(team, "todos").map((tab) => tab.id)).not.toContain("task-board");
    expect(hubStripTabs(team, "todos", "task-board").map((tab) => tab.id)).toContain("task-board");
  });

  it("keeps student-facing hub descriptions free of workbench chrome talk", () => {
    for (const hub of NAV_HUBS) {
      expect(hub.description, hub.id).toBeTruthy();
      expect(hub.description, hub.id).not.toMatch(/tabs inside|workbench|Soft-UI/i);
    }
  });

  it("sends the Business outreach calendar tab to /outreach-calendar, not the content calendar", () => {
    const business = hubById("business");
    expect(business.tabs.find((tab) => tab.id === "outreach-calendar")?.legacyHref).toBe(
      "/outreach-calendar",
    );
    expect(business.tabs.filter((tab) => tab.legacyHref === "/team/grants")).toHaveLength(1);
  });
});
