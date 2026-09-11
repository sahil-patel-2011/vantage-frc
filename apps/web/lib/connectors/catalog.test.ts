import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  STUDENT_CONNECTOR_LEAK,
  connectorAudienceFromRole,
  connectorById,
  connectorCallbackUrl,
  connectorScopeNote,
  connectorStatusLine,
  connectorsPageDescription,
  describeConnector,
  deploymentBaseUrl,
  joinEnvNames,
  missingConnectorEnv,
  studentPermissionsCopy,
  type ConnectorDefinition,
} from "./catalog";

const BASE = { BETTER_AUTH_URL: "https://vantage.example.com" };

describe("connector catalog shape", () => {
  it("gives every connector a unique id, a label and something it powers", () => {
    const ids = CONNECTORS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CONNECTORS) {
      expect(entry.label.length, entry.id).toBeGreaterThan(2);
      expect(entry.powers.length, `${entry.id} must say what breaks without it`).toBeGreaterThan(20);
      expect(entry.managePath.startsWith("/"), entry.id).toBe(true);
      expect(entry.providerConsole.length, `${entry.id} must name the provider console`).toBeGreaterThan(10);
    }
  });

  it("covers the seven connectors the owner reported plus the two CAD ones", () => {
    const ids = CONNECTORS.map((entry) => entry.id);
    for (const id of [
      "github",
      "tba",
      "discord",
      "slack",
      "email",
      "stripe",
      "storage-node",
      "google",
      "onshape",
      "fusion-relay",
      "free-relay",
    ]) {
      expect(ids, `${id} missing from the catalog`).toContain(id);
    }
  });

  it("declares a callback label for every connector that has a callback path", () => {
    for (const entry of CONNECTORS) {
      if (entry.callbackPath) {
        expect(entry.callbackLabel.length, `${entry.id} needs a name for its callback field`).toBeGreaterThan(3);
      }
    }
  });

  it("throws on an unknown id rather than returning a blank card", () => {
    expect(() => connectorById("nope" as never)).toThrow(/Unknown connector/);
  });
});

describe("deploymentBaseUrl", () => {
  it("prefers BETTER_AUTH_URL and strips the trailing slash", () => {
    expect(deploymentBaseUrl({ BETTER_AUTH_URL: "https://a.example.com/" })).toBe("https://a.example.com");
  });

  it("falls back to NEXT_PUBLIC_APP_URL, then to the dev port", () => {
    expect(deploymentBaseUrl({ NEXT_PUBLIC_APP_URL: "https://b.example.com" })).toBe("https://b.example.com");
    expect(deploymentBaseUrl({})).toBe("http://localhost:3001");
  });
});

describe("connectorCallbackUrl", () => {
  it("is readable with no credentials set at all — the whole point", () => {
    const github = connectorById("github");
    expect(connectorCallbackUrl(github, BASE)).toBe(
      "https://vantage.example.com/api/github/oauth/callback",
    );
  });

  it("honours the explicit redirect override when the deployment sets one", () => {
    const github = connectorById("github");
    expect(
      connectorCallbackUrl(github, { ...BASE, GITHUB_OAUTH_REDIRECT_URI: "https://alt.example.com/cb" }),
    ).toBe("https://alt.example.com/cb");
  });

  it("returns null for a key-only connector that needs no URL from us", () => {
    expect(connectorCallbackUrl(connectorById("tba"), BASE)).toBeNull();
  });

  it("points Stripe at the webhook route the app actually serves", () => {
    expect(connectorCallbackUrl(connectorById("stripe"), BASE)).toBe(
      "https://vantage.example.com/api/stripe/webhook",
    );
  });

  it("points Slack at the events route the app actually serves", () => {
    expect(connectorCallbackUrl(connectorById("slack"), BASE)).toBe(
      "https://vantage.example.com/api/integrations/slack/events",
    );
  });

  it("points Google at Better Auth's own callback path", () => {
    expect(connectorCallbackUrl(connectorById("google"), BASE)).toBe(
      "https://vantage.example.com/api/auth/callback/google",
    );
  });
});

describe("missingConnectorEnv", () => {
  it("lists every blank required variable in declaration order", () => {
    expect(missingConnectorEnv(connectorById("github"), BASE)).toEqual([
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
    ]);
  });

  it("treats a whitespace-only value as unset", () => {
    expect(
      missingConnectorEnv(connectorById("stripe"), {
        ...BASE,
        STRIPE_SECRET_KEY: "   ",
        STRIPE_WEBHOOK_SECRET: "whsec_live",
      }),
    ).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("is empty once every required variable is present", () => {
    expect(
      missingConnectorEnv(connectorById("email"), {
        RESEND_API_KEY: "re_x",
        AUTH_EMAIL_FROM: "Vantage <a@b.org>",
      }),
    ).toEqual([]);
  });
});

describe("joinEnvNames", () => {
  it("reads as a sentence rather than an array", () => {
    expect(joinEnvNames([])).toBe("");
    expect(joinEnvNames(["A"])).toBe("A");
    expect(joinEnvNames(["A", "B"])).toBe("A and B");
    expect(joinEnvNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("connectorStatusLine", () => {
  it("names the account when the provider told us one", () => {
    expect(connectorStatusLine({ state: "connected", account: "jane@team.org" })).toBe(
      "Connected as jane@team.org",
    );
  });

  it("says plain Connected rather than 'Connected as null'", () => {
    expect(connectorStatusLine({ state: "connected", account: null })).toBe("Connected");
    expect(connectorStatusLine({ state: "connected", account: "  " })).toBe("Connected");
  });

  it("names the missing variables in the not-configured line", () => {
    expect(
      connectorStatusLine({ state: "not_configured", missingEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }),
    ).toBe("Not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  });

  it("tells an expired token to reconnect", () => {
    expect(connectorStatusLine({ state: "token_expired" })).toBe("Token expired — reconnect");
  });
});

describe("describeConnector", () => {
  it("names variables, the place to set them, and the URL to register", () => {
    const status = describeConnector(connectorById("github"), BASE);
    expect(status.state).toBe("not_configured");
    expect(status.statusLine).toBe(
      "Not configured — set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET",
    );
    expect(status.detail).toContain("GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET");
    expect(status.detail).toContain("Environment Variables");
    expect(status.detail).toContain("https://vantage.example.com/api/github/oauth/callback");
  });

  it("never offers Connect for a connector whose credentials are missing", () => {
    const status = describeConnector(connectorById("github"), BASE);
    expect(status.canConnect).toBe(false);
    expect(status.canDisconnect).toBe(false);
  });

  it("offers Connect once the platform credentials exist", () => {
    const status = describeConnector(connectorById("github"), {
      ...BASE,
      GITHUB_OAUTH_CLIENT_ID: "Iv1.x",
      GITHUB_OAUTH_CLIENT_SECRET: "s",
    });
    expect(status.state).toBe("ready");
    expect(status.canConnect).toBe(true);
    expect(status.canDisconnect).toBe(false);
  });

  it("never claims Connected from environment alone for a team connector", () => {
    const status = describeConnector(connectorById("github"), {
      ...BASE,
      GITHUB_OAUTH_CLIENT_ID: "Iv1.x",
      GITHUB_OAUTH_CLIENT_SECRET: "s",
    });
    expect(status.state).not.toBe("connected");
  });

  it("reports Connected as the login once a real row exists", () => {
    const status = describeConnector(
      connectorById("github"),
      { ...BASE, GITHUB_OAUTH_CLIENT_ID: "Iv1.x", GITHUB_OAUTH_CLIENT_SECRET: "s" },
      { linked: true, account: "team3005-bot" },
    );
    expect(status.state).toBe("connected");
    expect(status.statusLine).toBe("Connected as team3005-bot");
    expect(status.canDisconnect).toBe(true);
  });

  it("calls a past-expiry token with no refresh token expired, and offers a reconnect", () => {
    const status = describeConnector(
      connectorById("onshape"),
      { ...BASE, ONSHAPE_OAUTH_CLIENT_ID: "id", ONSHAPE_OAUTH_CLIENT_SECRET: "s" },
      { linked: true, account: "jane@team.org", expiresAt: Date.now() - 1000, refreshable: false },
    );
    expect(status.state).toBe("token_expired");
    expect(status.statusLine).toBe("Token expired — reconnect");
    expect(status.canConnect).toBe(true);
    expect(status.canDisconnect).toBe(true);
  });

  it("stays Connected past expiry when a refresh token can renew it unattended", () => {
    const status = describeConnector(
      connectorById("onshape"),
      { ...BASE, ONSHAPE_OAUTH_CLIENT_ID: "id", ONSHAPE_OAUTH_CLIENT_SECRET: "s" },
      { linked: true, account: "jane@team.org", expiresAt: Date.now() - 1000, refreshable: true },
    );
    expect(status.state).toBe("connected");
  });

  it("treats a fully configured platform connector as connected — there is no second row to make", () => {
    const status = describeConnector(connectorById("email"), {
      ...BASE,
      RESEND_API_KEY: "re_x",
      AUTH_EMAIL_FROM: "Vantage <a@b.org>",
    });
    expect(status.state).toBe("connected");
  });

  it("shows a key-only connector the console to create the key in, not a callback URL", () => {
    const status = describeConnector(connectorById("tba"), BASE);
    expect(status.callbackUrl).toBeNull();
    expect(status.detail).toContain("thebluealliance.com");
    expect(status.statusLine).toBe("Not configured — set TBA_AUTH_KEY");
  });

  it("lets a connector override the detail with its own note", () => {
    const status = describeConnector(connectorById("discord"), BASE, {
      note: "Webhook saved for this team; the chat bridge is off.",
    });
    expect(status.detail).toBe("Webhook saved for this team; the chat bridge is off.");
  });

  // The combination that produced an incoherent card: a stored credential that
  // GitHub had refused, on a deployment whose OAuth client had since been
  // rotated away. The old ordering decided "not configured" first, so the badge
  // said one thing, the paragraph said another, and Disconnect was hidden —
  // leaving the dead token in the row with no way to clear it.
  describe("a stored link on a deployment that lost its credentials", () => {
    const rejected = {
      linked: true,
      account: "team3005-bot",
      expiresAt: 1,
      refreshable: false,
      note: "GitHub refused the stored credential for @team3005-bot.",
    };

    it("reports the link's own state, not the missing variable", () => {
      const status = describeConnector(connectorById("github"), BASE, rejected);
      expect(status.state).toBe("token_expired");
      expect(status.statusLine).toBe("Token expired — reconnect");
    });

    it("still says which variable is missing, rather than swallowing it", () => {
      const status = describeConnector(connectorById("github"), BASE, rejected);
      expect(status.detail).toContain("GitHub refused the stored credential");
      expect(status.detail).toContain("GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET");
      expect(status.missingEnv).toEqual(["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"]);
    });

    it("offers Disconnect — the token is real and only this clears it", () => {
      expect(describeConnector(connectorById("github"), BASE, rejected).canDisconnect).toBe(true);
    });

    it("refuses Connect, because a new authorisation genuinely cannot start", () => {
      expect(describeConnector(connectorById("github"), BASE, rejected).canConnect).toBe(false);
    });

    it("offers both once the credentials are back", () => {
      const status = describeConnector(
        connectorById("github"),
        { ...BASE, GITHUB_OAUTH_CLIENT_ID: "Iv1.x", GITHUB_OAUTH_CLIENT_SECRET: "s" },
        rejected,
      );
      expect(status.canConnect).toBe(true);
      expect(status.canDisconnect).toBe(true);
      expect(status.detail).not.toContain("GITHUB_OAUTH_CLIENT_ID");
    });

    it("mentions the missing variable on a healthy link too, so the next rotation is not a surprise", () => {
      const status = describeConnector(connectorById("github"), BASE, {
        linked: true,
        account: "team3005-bot",
      });
      expect(status.state).toBe("connected");
      expect(status.statusLine).toBe("Connected as team3005-bot");
      expect(status.detail).toContain("GITHUB_OAUTH_CLIENT_ID");
    });
  });

  it("gives every catalog entry an actionable detail with no credentials at all", () => {
    for (const def of CONNECTORS as ConnectorDefinition[]) {
      const status = describeConnector(def, {});
      expect(status.detail.length, `${def.id} detail is too thin to act on`).toBeGreaterThan(40);
      // Nothing may claim a link exists purely because the environment is bare.
      if (status.state === "connected") {
        expect(def.requiredEnv.length, `${def.id} claimed Connected with nothing set`).toBe(0);
      }
    }
  });
});

describe("student connector cards", () => {
  it("treats owners and admins as operators, everyone else as students", () => {
    expect(connectorAudienceFromRole(true)).toBe("operator");
    expect(connectorAudienceFromRole(false)).toBe("student");
  });

  it("does not name Onshape OAuth, env vars, Resend, or Vercel on any student card", () => {
    for (const def of CONNECTORS as ConnectorDefinition[]) {
      const status = describeConnector(def, BASE, {}, "student");
      expect(status.label, def.id).not.toMatch(/Resend|OAuth/i);
      expect(status.statusLine, def.id).not.toMatch(STUDENT_CONNECTOR_LEAK);
      expect(status.detail, def.id).not.toMatch(STUDENT_CONNECTOR_LEAK);
      expect(status.missingEnv, def.id).toEqual([]);
      expect(status.callbackUrl, def.id).toBeNull();
      expect(status.permissions, def.id).toEqual([studentPermissionsCopy(def.id)]);
      expect(status.permissions.join(" "), def.id).not.toMatch(STUDENT_CONNECTOR_LEAK);
    }
  });

  it("names Onshape document read/edit for students, not OAuth2Read", () => {
    const student = describeConnector(connectorById("onshape"), BASE, {}, "student");
    expect(student.permissions).toEqual(["Vantage can read and edit Onshape documents you pick."]);
    expect(student.permissions.join(" ")).not.toMatch(/OAuth2Read|CLIENT_SECRET/i);
  });

  it("keeps the Connectors page lead student-safe", () => {
    expect(connectorsPageDescription({ canManage: false, summary: "1 connected" })).toBe(
      "Connect Onshape, GitHub, and the other services this team uses. Ask a mentor when a card says to. 1 connected.",
    );
    expect(connectorsPageDescription({ canManage: false, summary: "1 connected" })).not.toMatch(
      STUDENT_CONNECTOR_LEAK,
    );
    expect(connectorScopeNote("member", "student")).toBe("Personal — you connect your own account.");
    expect(connectorScopeNote("platform", "student")).toMatch(/ask a mentor/i);
    expect(connectorScopeNote("platform", "operator")).toMatch(/Deployment-wide/);
  });

  it("asks a mentor when Onshape is not ready, and still names env vars for operators", () => {
    const student = describeConnector(connectorById("onshape"), BASE, {}, "student");
    expect(student.statusLine).toBe("Ask a mentor to finish setup");
    expect(student.detail).toMatch(/Ask a mentor to finish Onshape/);
    const operator = describeConnector(connectorById("onshape"), BASE);
    expect(operator.statusLine).toContain("ONSHAPE_OAUTH_CLIENT_ID");
    expect(operator.missingEnv).toEqual(["ONSHAPE_OAUTH_CLIENT_ID", "ONSHAPE_OAUTH_CLIENT_SECRET"]);
  });

  it("drops a leaky stored note on the student card instead of printing it", () => {
    const status = describeConnector(
      connectorById("github"),
      BASE,
      { note: "Linked via OAuth; set GITHUB_OAUTH_CLIENT_ID." },
      "student",
    );
    expect(status.detail).not.toMatch(STUDENT_CONNECTOR_LEAK);
    expect(status.detail).toMatch(/Ask a mentor to finish GitHub/);
  });

  it("student free-relay card is paste-token only, never a Freebuff wrapper", () => {
    const student = describeConnector(connectorById("free-relay"), BASE, {}, "student");
    expect(student.permissions).toEqual([
      "Paste the token the team's Raspberry Pi prints. Never a Freebuff website cookie, a browser extension, or a bookmarklet.",
    ]);
    expect(student.callbackUrl).toBeNull();
    expect(student.permissions.join(" ")).not.toMatch(STUDENT_CONNECTOR_LEAK);
    expect(student.permissions.join(" ")).not.toMatch(/freebuff\.com/i);
    expect(student.statusLine).not.toMatch(/Setup required/);
  });
});
