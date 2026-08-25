import { describe, expect, it } from "vitest";
import { teamHqLinks } from "./team-hq";

describe("teamHqLinks", () => {
  it("returns calendar, chat, playbook, and GitHub", () => {
    const links = teamHqLinks("11111111-1111-4111-8111-111111111111");
    expect(links.map((link) => link.id)).toEqual(["calendar", "messages", "knowledge", "github"]);
    expect(links.find((link) => link.id === "github")?.href).toContain("/team/admin");
    expect(links.find((link) => link.id === "github")?.href).toContain("#github-connection");
  });

  it("omits the active surface", () => {
    expect(teamHqLinks(null, "calendar").map((link) => link.id)).toEqual([
      "messages",
      "knowledge",
      "github",
    ]);
  });
});
