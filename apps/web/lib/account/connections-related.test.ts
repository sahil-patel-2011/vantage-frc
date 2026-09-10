import { describe, expect, it } from "vitest";
import {
  CONNECTIONS_RELATED_INCLUDE,
  buildConnectionConnectors,
  classifyConnectionsShell,
  connectionBadgeLabel,
  connectionBadgeTone,
  connectionsEmptyCopy,
  connectionsNextActions,
  connectionsRelatedLinks,
} from "./connections-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("connectionsRelatedLinks", () => {
  it("builds Account / CAD / Discord cross-links with careful hrefs", () => {
    const links = connectionsRelatedLinks("org-1", { include: [...CONNECTIONS_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["account", "cad", "discord", "slack"]);
    expect(links.find((l) => l.id === "account")?.href).toBe("/account?tab=integrations");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/cad/connections?orgId=org-1");
    expect(links.find((l) => l.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
  });

  it("never uses DEMO labels", () => {
    const links = connectionsRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    expect(CONNECTIONS_RELATED_INCLUDE).toEqual(["account", "cad", "discord", "slack"]);
  });
});

describe("connection badges", () => {
  it("only marks Connected as good — never invents DEMO connected", () => {
    expect(connectionBadgeLabel("connected")).toBe("Connected");
    expect(connectionBadgeTone("connected")).toBe("good");
    expect(connectionBadgeLabel("setup_required")).toBe("Setup required");
    expect(connectionBadgeTone("empty")).toBe("setup");
    expect(connectionBadgeLabel("available")).toBe("Ready");
  });
});

describe("classifyConnectionsShell", () => {
  it("is setup without a workspace", () => {
    expect(classifyConnectionsShell({ orgId: null })).toBe("setup");
  });

  it("is empty when nothing is linked", () => {
    expect(
      classifyConnectionsShell({
        orgId: "org-1",
        connectors: [{ status: "empty" }, { status: "setup_required" }],
      }),
    ).toBe("empty");
  });

  it("is ready when a real connector is available or connected", () => {
    expect(
      classifyConnectionsShell({
        orgId: "org-1",
        connectors: [{ status: "available" }, { status: "empty" }],
      }),
    ).toBe("ready");
    expect(
      classifyConnectionsShell({
        orgId: "org-1",
        connectors: [{ status: "connected" }],
      }),
    ).toBe("ready");
  });
});

describe("connectionsEmptyCopy", () => {
  it("keeps setup / empty honest", () => {
    expect(connectionsEmptyCopy("setup").badge).toBe("Setup required");
    expectPlainCopy(connectionsEmptyCopy("empty").description.toLowerCase());
    expect(connectionsEmptyCopy("empty").description).not.toMatch(/\bdemo\b/i);
  });
});

describe("connectionsNextActions", () => {
  it("prioritizes workspace when no org is active", () => {
    const actions = connectionsNextActions({ orgId: null });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.label))).toBe(true);
  });

  it("points at CAD and Discord for missing team connectors", () => {
    const actions = connectionsNextActions({
      orgId: "org-1",
      googleReady: true,
      tbaReady: true,
      onshapeStatus: "empty",
      discordStatus: "empty",
      githubStatus: "connected",
    });
    expect(actions.some((a) => a.id === "onshape")).toBe(true);
    expect(actions.find((a) => a.id === "onshape")?.href).toBe("/cad/connections?orgId=org-1");
    expect(actions.find((a) => a.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
  });
});

describe("buildConnectionConnectors", () => {
  it("never marks Connected without connected status from the API", () => {
    const cards = buildConnectionConnectors({
      orgId: "org-1",
      google: { status: "available", detail: "Google OAuth configured." },
      tba: { status: "setup_required", detail: "No TBA key." },
      onshape: { status: "empty", detail: "OAuth ready — not authorized yet." },
      discord: { status: "setup_required", detail: "No webhook." },
      github: { status: "empty", detail: "No GitHub link." },
    });
    expect(cards.every((c) => c.status !== "connected")).toBe(true);
    expect(cards.find((c) => c.id === "onshape")?.href).toBe("/cad/connections?orgId=org-1");
    expect(cards.find((c) => c.id === "discord")?.href).toBe("/team/discord?orgId=org-1");
    expect(cards.find((c) => c.id === "github")?.href).toBe("/team/admin?orgId=org-1#github-connection");
  });

  it("preserves a real Connected status when provided", () => {
    const cards = buildConnectionConnectors({
      orgId: "org-1",
      onshape: { status: "connected", detail: "Onshape OAuth linked." },
    });
    expect(cards.find((c) => c.id === "onshape")?.status).toBe("connected");
  });
});
