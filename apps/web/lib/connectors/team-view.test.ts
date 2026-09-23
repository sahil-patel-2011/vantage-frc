import { describe, expect, it } from "vitest";
import { buildConnectorStatuses } from "./load-connector-status";
import { connectorsForViewer } from "./team-view";

describe("connectorsForViewer", () => {
  const all = buildConnectorStatuses({} as NodeJS.ProcessEnv, {}, "operator");

  it("shows the platform admin everything, plumbing included", () => {
    expect(connectorsForViewer(all, { platformAdmin: true })).toEqual(all);
  });

  it("never shows a team deployment-wide connectors or setup details", () => {
    const team = connectorsForViewer(all, { platformAdmin: false });
    expect(team.every((connector) => connector.scope !== "platform")).toBe(true);
    expect(team.every((connector) => connector.state !== "not_configured")).toBe(true);
    expect(team.every((connector) => connector.missingEnv.length === 0 && connector.callbackUrl === null)).toBe(true);
    expect(team.some((connector) => connector.id === "email" || connector.id === "stripe")).toBe(false);
  });
});
