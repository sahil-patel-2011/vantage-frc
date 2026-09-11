import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { homeNowAction } from "../../app/dashboard/dashboard-home-model";
import { cadNextActions } from "../cad/cad-related";
import { eventDayShellCopy } from "../command/event-day-related";
import { hoursSelfViewShellCopy } from "../hours-self-view/hours-self-view-related";
import { cadVaultShellCopy } from "../cad-vault/cad-vault-related";
import { myDayNextActions, myDayShellCopy } from "../my-day-related";
import { hubById, hubFeaturedMoreTabs } from "../nav/hubs";
import { scoutingShellCopy } from "../scouting/scouting-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const THIS_WEEK = [
  "app/dashboard/dashboard-home-model.ts",
  "lib/my-day-related.ts",
  "app/my-day/my-day-client.tsx",
  "lib/scouting/scouting-related.ts",
  "app/scouting/scouting-client.tsx",
  "app/scouting/scouting-ready-view.tsx",
  "app/command/command-chrome.tsx",
  "lib/command/event-day-related.ts",
  "lib/cad/cad-related.ts",
  "app/cad/cad-ready-view.tsx",
  "app/hours-self-view/hours-self-view-client.tsx",
  "app/todos/todos-client.tsx",
  "lib/cad-vault/cad-vault-related.ts",
  "app/cad-vault/cad-vault-client.tsx",
  "components/product-hub.tsx",
] as const;

describe("student-week action path", () => {
  it("Home clocked-in leads to My Hours; empty stays Nothing you have to do right now", () => {
    expect(homeNowAction({ orgId: "org-1", clockedIn: true })).toEqual({
      title: "You’re in the shop",
      detail: "Your hours are still running.",
      href: "/hours-self-view",
      cta: "Open My Hours",
    });
    expect(homeNowAction({ orgId: "org-1" }).title).toBe("Nothing you have to do right now");
    expect(homeNowAction({ orgId: "org-1", nextMatchLabel: "Qual 3" }).href).toBe("/my-day");
  });

  it("My Day setup is Needs setup without TBA, and ready primary is Scout this match", () => {
    expect(myDayShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(myDayShellCopy("setup").description);
    expect(JSON.stringify(myDayShellCopy("setup"))).not.toMatch(/TBA|Blue Alliance|Connect TBA/);
    const ready = myDayNextActions({ orgId: "org-1", shell: "ready" });
    expect(ready[0]?.label).toBe("Scout this match");
    expect(ready[0]?.primary).toBe(true);
  });

  it("Scouting setup is Needs setup without TBA and save copy is student-readable", () => {
    expect(scoutingShellCopy("setup").badge).toBe("Needs setup");
    expect(JSON.stringify(scoutingShellCopy("setup"))).not.toMatch(/TBA|Blue Alliance|schema/i);
    const ready = readFileSync(join(WEB, "app/scouting/scouting-ready-view.tsx"), "utf8");
    expect(ready).toMatch(/Save this \$\{type\}/);
    expect(ready).toContain("Save on this phone");
    expect(ready).not.toMatch(/The Blue Alliance|Connect TBA/);
    const client = readFileSync(join(WEB, "app/scouting/scouting-client.tsx"), "utf8");
    expect(client).toMatch(/putFeatureSnapshot\("scouting"/);
    expect(client).toMatch(/AbortSignal\.timeout\(FEATURE_API_TIMEOUT_MS\)/);
    expect(client).toMatch(/response\.status === 401 \|\| response\.status === 403/);
  });

  it("Event Day student chrome does not say Connect TBA", () => {
    expect(eventDayShellCopy("setup").description).not.toMatch(/TBA|Blue Alliance/);
    expect(eventDayShellCopy("empty").description).not.toMatch(/TBA|Blue Alliance/);
    const chrome = readFileSync(join(WEB, "app/command/command-chrome.tsx"), "utf8");
    expect(chrome).not.toMatch(/Connect TBA/);
    expect(chrome).toMatch(/Set the event you’re at/);
  });

  it("CAD next actions stay link-first without OAuth or env names", () => {
    const actions = cadNextActions({
      orgId: "org-1",
      jobCount: 0,
      onshapeConfigured: false,
      onshapeConnected: false,
      fusionRelayOnline: false,
    });
    expect(actions[0]?.label).toBe("Link a CAD document");
    expect(actions[0]?.href).toContain("/cad-vault");
    expect(JSON.stringify(actions)).not.toMatch(/OAuth|ONSHAPE_|Setup required|vantage-cad/);
  });

  it("Competition featured tools include Match video; Build CAD strip includes CAD vault", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toEqual([
      "briefing",
      "video-analysis",
      "packing",
      "alliance-selection-desk",
      "picks",
    ]);
    expect(hubById("competition").tabs.find((tab) => tab.id === "video-analysis")?.label).toBe(
      "Match video",
    );
    expect(hubById("build").tabs.find((tab) => tab.id === "cad-vault")?.featured).toBe(true);
  });

  it("Hours, Todos, and CAD vault setup badges are Needs setup", () => {
    expect(hoursSelfViewShellCopy("setup").badge).toBe("Needs setup");
    expect(cadVaultShellCopy("setup").badge).toBe("Needs setup");
    const todos = readFileSync(join(WEB, "app/todos/todos-client.tsx"), "utf8");
    expect(todos).toMatch(/badge="Needs setup"/);
    expect(todos).not.toMatch(/Setup required/);
    const vault = readFileSync(join(WEB, "app/cad-vault/cad-vault-client.tsx"), "utf8");
    expect(vault).toMatch(/classifyCadVaultShell\(\{ authBlocked, fetchFailed \}\)/);
    expect(vault).toMatch(/clearFeatureSnapshot\("cad-vault"/);
  });

  it("does not print leftover Setup required / TBA / OAuth on this week's boards", () => {
    for (const rel of THIS_WEEK) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Connect TBA/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/ONSHAPE_/);
      expect(src, rel).not.toMatch(/Connect Onshape with OAuth/);
    }
  });
});
