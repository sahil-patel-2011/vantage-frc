/**
 * The Onshape connector's connect/disconnect contract.
 *
 * The bug this pins: `/api/cad/onshape` shipped with only an `authorize-url`
 * action, so a member who had authorised Onshape had no way to revoke the token
 * Vantage was holding — and the Connections page had no Disconnect button to
 * offer. A second bug rode along with it: because the callback matched the
 * existing row with `disabled_at IS NULL`, once a disconnect set that column the
 * next reconnect inserted a duplicate row instead of reviving the member's own.
 *
 * These are source-text assertions on purpose. The route needs a real session,
 * a real RLS transaction and a real KMS to execute, none of which a
 * credential-free unit test has; what it can guarantee is that the action
 * exists, that it overwrites the stored envelope rather than only flagging a
 * status, and that it stays reachable when the OAuth client env is gone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { onshapeAccountLabel } from "./onshape-setup-strings";

const WEB_ROOT = join(__dirname, "..", "..");
const route = readFileSync(join(WEB_ROOT, "app/api/cad/onshape/route.ts"), "utf8");
const callback = readFileSync(join(WEB_ROOT, "app/api/cad/onshape/oauth/callback/route.ts"), "utf8");
const client = readFileSync(join(WEB_ROOT, "app/cad/connections/connections-client.tsx"), "utf8");

describe("POST /api/cad/onshape disconnect", () => {
  it("accepts a disconnect action", () => {
    expect(route).toContain('body.action === "disconnect"');
  });

  it("overwrites the encrypted envelope rather than only setting a status", () => {
    expect(route).toContain("encryptSecret");
    expect(route).toContain("encrypted_credentials=$3");
    expect(route).toContain("status='disconnected'");
    expect(route).toContain("disabled_at=now()");
  });

  it("stays reachable when the OAuth client env is missing", () => {
    // The disconnect branch must come before the getOnshapeOAuthConfig() gate.
    const disconnectAt = route.indexOf('body.action === "disconnect"');
    const configGateAt = route.indexOf("const config = getOnshapeOAuthConfig()");
    expect(disconnectAt).toBeGreaterThan(-1);
    expect(configGateAt).toBeGreaterThan(-1);
    expect(disconnectAt).toBeLessThan(configGateAt);
  });

  it("scopes the update to the caller's own org membership and row", () => {
    expect(route).toContain("FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid");
    expect(route).toContain("WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape'");
  });

  it("reports the exact missing setting when OAuth is unconfigured", () => {
    // Not the old bare "Onshape OAuth is not configured".
    expect(route).toContain("onshapeSetupStatus().message");
    expect(route).not.toContain('error: "Onshape OAuth is not configured"');
  });
});

describe("Onshape OAuth callback", () => {
  it("revives the member's existing row instead of inserting a duplicate", () => {
    const lookup = callback.slice(
      callback.indexOf("SELECT id FROM cad_connections"),
      callback.indexOf("if (existing.rows[0])"),
    );
    expect(lookup).toContain("platform='onshape'");
    expect(lookup).not.toContain("disabled_at IS NULL");
    expect(callback).toContain("disabled_at=NULL");
  });

  it("stores the Onshape account, not the Vantage user id", () => {
    expect(callback).toContain("fetchOnshapeSessionInfo");
    expect(callback).toContain("onshapeAccountRef");
    expect(callback).not.toContain("`onshape:${session.user.id}`");
  });
});

describe("Connections page", () => {
  it("offers Disconnect once a connection exists", () => {
    expect(client).toContain("disconnectOnshape");
    expect(client).toContain('action: "disconnect"');
    expect(client).toMatch(/>\s*Disconnect\s*</);
  });

  it("keeps OAuth portal URLs off the student Connections page", () => {
    // Mentors register the callback under Connectors. Students see Connect /
    // Needs setup, never the Onshape developer portal or a callback URL.
    expect(client).not.toContain("onshapeCallbackUrl");
    expect(client).not.toContain("dev-portal.onshape.com");
    expect(client).toContain("ONSHAPE_OAUTH_CTA");
    expect(client).toContain("Needs setup");
  });
});

describe("onshapeAccountLabel", () => {
  it("reads the account out of the stored ref", () => {
    expect(onshapeAccountLabel("onshape:jane@team.org")).toBe("jane@team.org");
    expect(onshapeAccountLabel("jane@team.org")).toBe("jane@team.org");
  });

  it("returns null for absent, blank, or legacy user-id refs", () => {
    expect(onshapeAccountLabel(null)).toBeNull();
    expect(onshapeAccountLabel(undefined)).toBeNull();
    expect(onshapeAccountLabel("onshape:")).toBeNull();
    // Legacy rows stored the Vantage user uuid; naming that helps nobody.
    expect(onshapeAccountLabel("onshape:3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBeNull();
  });
});
