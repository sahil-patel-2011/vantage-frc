import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * Hosted /api/cad + /api/cad/agent must decide "connected" through
 * hostedOnshapeEnvAuth / hostedOnshapeAgentAuth. Those helpers ignore
 * ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY. A future keys-are-connected
 * shortcut on either route has to break this extract first.
 */
describe("hosted CAD routes do not treat API keys as connected", () => {
  const cad = read("app/api/cad/route.ts");
  const agent = read("app/api/cad/agent/route.ts");

  it("GET /api/cad reports hosted env auth, not keys", () => {
    expect(cad).toContain('from "../../../lib/cad/hosted-auth"');
    expect(cad).toContain("hostedOnshapeEnvAuth");
    expect(cad).toContain("readHostedOnshapeEnvFlags");
    expect(cad).toContain("hostedOnshapeEnvAuth(readHostedOnshapeEnvFlags())");
    expect(cad).toContain("configured: hosted.configured");
    expect(cad).toContain("setupRequired: hosted.setupRequired");
    expect(cad).toContain("onshapeConfigured: hosted.configured");
    expect(cad).toContain("hostedFusionSetup");
    expect(cad).toContain("fusionConfigured: fusion.configured");
    expect(cad).toContain(
      "Connect Onshape in CAD Connections. A saved Onshape password on the server does not count as connected.",
    );
    expect(cad).not.toContain("readOnshapeApiKeys");
    expect(cad).not.toMatch(/onshapeConnected:\s*true/);
    expect(cad).not.toMatch(/connected:\s*Boolean\((?:readOnshapeApiKeys|process\.env\.ONSHAPE_)/);
  });

  it("GET /api/cad/agent reports hostedOnshapeAgentAuth.connected", () => {
    expect(agent).toContain('from "../../../../lib/cad/hosted-auth"');
    expect(agent).toContain("hostedOnshapeAgentAuth");
    expect(agent).toContain("readHostedOnshapeEnvFlags");
    expect(agent).toContain("return hostedOnshapeAgentAuth({");
    expect(agent).toContain("sessionConnected: Boolean(connection.rowCount)");
    expect(agent).toContain("onshapeConfigured: availability.configured");
    expect(agent).toContain("onshapeConnected: availability.connected");
    expect(agent).not.toContain("readOnshapeApiKeys");
    expect(agent).not.toMatch(/onshapeConnected:\s*true/);
    expect(agent).not.toMatch(/connected:\s*Boolean\((?:readOnshapeApiKeys|process\.env\.ONSHAPE_)/);
  });

  it("agent chat and bind refuse when hosted auth is not connected", () => {
    expect(agent).toContain("if (!availability.connected)");
    const connectedChecks = agent.match(/if \(!availability\.connected\)/g) ?? [];
    expect(connectedChecks.length).toBeGreaterThanOrEqual(3);
  });
});
