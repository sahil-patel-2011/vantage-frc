import { describe, expect, it } from "vitest";
import { PERSONAL_FEATURE_TOOLS, personalFeatureToolRegistry, validateFeatureToolInput } from "../src/feature-tools.js";
import { FakeTransport, ok } from "./helpers.js";
import type { ConnectorConfig } from "../src/config.js";

const config: ConnectorConfig = { version: 1, baseUrl: "https://vantagefrc.vercel.app", machineName: "personal", deviceToken: "personal-token", deviceId: "device", orgId: "org", userId: "user", capabilities: {} };
describe("personal feature MCP tools", () => {
  it("rejects identity overrides, shell tools and invalid typed input before network access", () => {
    for (const input of [{ teamKey: "frc254", orgId: "someone-else" }, { teamKey: "frc254", userId: "someone-else" }, { teamKey: "not-frc" }, { teamKey: 254 }, null]) expect(() => validateFeatureToolInput("vantage_scouting_team", input)).toThrow();
    expect(() => validateFeatureToolInput("sql", {})).toThrow(/not available/);
    expect(() => validateFeatureToolInput("vantage_cad_briefs", { limit: 1.5 })).toThrow();
    expect(() => validateFeatureToolInput("vantage_finance_create_purchase_request", { title: "Bolts", justification: "Repair", quantity: -1 })).toThrow();
    expect(PERSONAL_FEATURE_TOOLS.filter((tool) => tool.mutation).every((tool) => tool.description.includes("confirm"))).toBe(true);
  });
  it("uses only the selected person's token and reloads it after re-pairing", async () => {
    const transport = new FakeTransport([{ match: "/device/tools", handler: () => ok({ result: { status: "proposed", requiresConfirmation: true } }) }]);
    let current = config;
    const registry = personalFeatureToolRegistry(transport, async () => current);
    const input = { title: "Bolts", justification: "Repair" };
    expect(await registry.call("vantage_finance_create_purchase_request", input)).toEqual({ status: "proposed", requiresConfirmation: true });
    expect(transport.requests[0]).toMatchObject({ token: "personal-token", body: { name: "vantage_finance_create_purchase_request", input } });
    expect(transport.requests[0]!.body).not.toHaveProperty("orgId");
    current = { ...config, deviceToken: "repaired-token" };
    await registry.call("vantage_cad_briefs", {});
    expect(transport.requests[1]!.token).toBe("repaired-token");
  });
  it("reports revocation and connection failures without fallback credentials", async () => {
    const transport = new FakeTransport([{ match: "/device/tools", handler: () => ok({ error: "Revoked" }, 401) }]);
    await expect(personalFeatureToolRegistry(transport, async () => config).call("vantage_cad_briefs", {})).rejects.toThrow("Revoked");
    await expect(personalFeatureToolRegistry(transport, async () => null).call("vantage_cad_briefs", {})).rejects.toThrow(/Pair/);
    await expect(personalFeatureToolRegistry(transport, async () => ({ ...config, baseUrl: "http://public.example" })).call("vantage_cad_briefs", {})).rejects.toThrow(/HTTPS/);
    expect(transport.requests).toHaveLength(1);
  });
});
