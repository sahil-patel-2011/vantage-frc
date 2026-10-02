import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import {
  baseOrigin,
  fixtureAccount,
  signInAs,
  normalizeLocalApiSession,
} from "./session";
import { serializeConsent } from "../../apps/web/lib/product-analytics/consent";
import AxeBuilder from "@axe-core/playwright";

test("public join screen stays focused, accessible and usable in both themes", async ({ page }, info) => {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/join-team");
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.getByRole("heading", { name: "Join your team", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menu and search" })).toHaveCount(0);
    await expect(page.locator(".soft-island")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    for (const name of ["FRC team number", "Team join code", "Your email"]) {
      const box = await page.getByRole("textbox", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`join-entry-${width}-${theme}.png`), fullPage: true });
  }
});

for (const width of [1440, 390])
  test(`team code, verified-email signup, rotation and disable at ${width}px`, async ({
    browser,
  }, info) => {
    test.setTimeout(300_000);
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/test|ci/);
    const pool = new Pool({ connectionString: url.toString(), ssl: false });
    const marker = `UI journey ${randomUUID()}`;
    const email = `ui-invite-${randomUUID()}@example.test`;
    const options = {
      baseURL: baseOrigin(),
      storageState: {
        cookies: [
          {
            name: "vantage-analytics-consent",
            value: serializeConsent("denied"),
            domain: new URL(baseOrigin()).hostname,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax" as const,
          },
        ],
        origins: [],
      },
    };
    const platform = await browser.newContext(options);
    const owner = await browser.newContext(options);
    const invited = await browser.newContext(options);
    let orgId: string | null = null;
    const headers = { origin: baseOrigin() };
    try {
      for (const current of [owner, invited]) {
        await current.setDefaultTimeout(20_000);
      }
      expect(await signInAs(platform, "platform")).toBe(true);
      expect(await signInAs(owner, "owner")).toBe(true);
      const teamNumber = (
        await pool.query(
          "SELECT n FROM generate_series(99000,99990) n WHERE NOT EXISTS(SELECT 1 FROM organizations WHERE team_number=n) AND NOT EXISTS(SELECT 1 FROM team_join_attempts WHERE bucket LIKE 'wrong:%:'||n AND reset_at>now()) LIMIT 1",
        )
      ).rows[0].n;
      const created = await platform.request.post("/api/admin/organizations", {
        headers,
        data: {
          name: marker,
          slug: marker.toLowerCase().replaceAll(" ", "-"),
          teamNumber,
          ownerEmail: fixtureAccount("owner").email,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      orgId = (await created.json()).id;
      expect(orgId).toBeTruthy();
      const manager = await owner.newPage();
      await manager.setViewportSize({ width, height: 900 });
      await manager.goto(`/team/admin?orgId=${orgId}`);
      await manager.getByText("Join with a team code", { exact: true }).click();
      await manager
        .getByRole("button", { name: "Generate join code", exact: true })
        .click();
      await expect(
        manager.getByLabel("Team join code", { exact: true }),
      ).toHaveText(/^\d{6}$/);
      await manager
        .getByRole("button", { name: "Change", exact: true })
        .click();
      await manager.getByLabel("New join code (optional)").fill("001234");
      await manager
        .getByRole("button", { name: "Save new code", exact: true })
        .click();
      await expect(
        manager.getByLabel("Team join code", { exact: true }),
      ).toHaveText("001234");
      await owner.grantPermissions(["clipboard-read", "clipboard-write"]);
      await manager
        .getByRole("button", { name: "Copy code", exact: true })
        .click();
      await expect(
        manager.getByRole("button", { name: "Copied", exact: true }),
      ).toBeVisible();
      expect(
        await manager.evaluate(() => navigator.clipboard.readText()),
      ).toContain("001234");
      await manager.reload();
      await manager.getByText("Join with a team code", { exact: true }).click();
      await expect(
        manager.getByLabel("Team join code", { exact: true }),
      ).toHaveText("001234");
      expect(
        (
          await new AxeBuilder({ page: manager })
            .include(".team-code-panel")
            .analyze()
        ).violations,
      ).toEqual([]);
      await manager.screenshot({
        path: info.outputPath(`team-code-${width}.png`),
        fullPage: false,
      });
      // Provider email delivery is intentionally not claimed by this local journey.
      const page = await invited.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/join-team");
      await expect(page.getByRole("button", { name: "Menu and search" })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
      await page.getByLabel("FRC team number").fill(String(teamNumber));
      await page.getByLabel("Team join code", { exact: true }).fill("999999");
      await page.getByLabel("Your email", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.locator(".join-team-error")).toContainText(
        "Check your team number",
      );
      await expect(page.getByLabel("Your email", { exact: true })).toHaveValue(
        email,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`join-team-${width}.png`),
        fullPage: true,
      });
      await page.getByLabel("Team join code", { exact: true }).fill("001234");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page).toHaveURL(/\/invite\?token=/);
      const link = new URL(page.url());
      await page.getByRole("link", { name: "Sign in to accept" }).click();
      await page
        .getByRole("textbox", { name: "Email", exact: true })
        .fill(email);
      await page
        .getByRole("button", { name: "Email me a sign-in code", exact: true })
        .click();
      const otp = String(
        createHmac("sha256", process.env.DEV_OTP_SECRET ?? "vantage-local-otp")
          .update(`${email}:sign-in`)
          .digest()
          .readUInt32BE(0) % 1_000_000,
      ).padStart(6, "0");
      await page.locator("input[autocomplete=one-time-code]").fill(otp);
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await (await fetch("/api/auth/get-session")).json())?.user
                ?.email,
          ),
        )
        .toBe(email);
      await normalizeLocalApiSession(invited);
      await expect
        .poll(async () =>
          (await invited.request.get("/api/auth/get-session"))
            .json()
            .then((data) => data?.user?.email),
        )
        .toBe(email);
      const ineligible = await invited.request.post("/api/invites/accept", {
        headers,
        data: {
          token: link.searchParams.get("token"),
          termsAccepted: true,
          privacyAccepted: true,
        },
      });
      expect(ineligible.status()).toBe(403);
      // Complete the real first screen, including its persisted progress.
      await page
        .getByRole("link", { name: "Finish your profile", exact: true })
        .click();
      await expect(page).toHaveURL(/\/onboarding(?:\?|$)/, { timeout: 60_000 });
      await page.getByLabel("First name", { exact: true }).fill("Journey");
      await page.getByLabel("Last name", { exact: true }).fill("Scout");
      await page.getByRole("radio", { name: /^Student/ }).check();
      await page.getByLabel(/Date of birth/).fill("2005-01-01");
      await page.getByLabel(/Gender/).selectOption("prefer_not_to_say");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      // An exact-email invite already supplies the team and role, so setup skips
      // asking the new scout to choose those details again.
      await expect(
        page.getByRole("region", {
          name: "Access request summary",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("checkbox", { name: /Terms of Service/ }).check();
      await page.getByRole("checkbox", { name: /Privacy Policy/ }).check();
      await page
        .getByRole("button", { name: new RegExp(`^Join ${marker}`) })
        .click();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND u.email=$2",
                [orgId, email],
              )
            ).rows[0]?.role,
          { timeout: 30_000 },
        )
        .toBe("scout");
      await page.getByRole("link", { name: "Open Home", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 60_000 });
      await expect(page.getByTestId("dash-customize")).toBeVisible({
        timeout: 30_000,
      });
      const me = await invited.request.get(`/api/me?orgId=${orgId}`);
      expect(await me.json()).toMatchObject({ orgId, role: "scout" });
      const blocked = await invited.request.post("/api/organizations/invites", {
        headers,
        data: { orgId, email: "blocked@example.test", role: "admin" },
      });
      expect(blocked.status()).toBe(403);
      expect(
        (
          await invited.request.get(
            `/api/organizations/join-code?orgId=${orgId}`,
          )
        ).status(),
      ).toBe(403);
      const pending = await invited.request.post("/api/teams/join", {
        headers,
        data: { teamNumber, pin: "001234", email: `pending-${email}` },
      });
      expect(pending.ok(), await pending.text()).toBe(true);
      await manager
        .getByRole("button", { name: "Change", exact: true })
        .click();
      await manager.getByLabel("New join code (optional)").fill("654321");
      await manager
        .getByRole("button", { name: "Save new code", exact: true })
        .click();
      await expect(
        manager.getByLabel("Team join code", { exact: true }),
      ).toHaveText("654321");
      expect(
        (
          await invited.request.post("/api/teams/join", {
            headers,
            data: { teamNumber, pin: "001234", email: `old-${email}` },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await pool.query(
            "SELECT status FROM invites WHERE org_id=$1 AND email=$2",
            [orgId, `pending-${email}`],
          )
        ).rows[0]?.status,
      ).toBe("revoked");
      await manager
        .getByRole("button", { name: "Change", exact: true })
        .click();
      await manager
        .getByRole("button", { name: "Turn off code", exact: true })
        .click();
      await manager
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(
        manager.getByLabel("Team join code", { exact: true }),
      ).toHaveText("654321");
      await manager
        .getByRole("button", { name: "Turn off code", exact: true })
        .click();
      await manager
        .getByRole("dialog")
        .getByRole("button", { name: "Turn off code", exact: true })
        .click();
      await expect(
        manager.getByRole("button", {
          name: "Generate join code",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (
          await invited.request.post("/api/teams/join", {
            headers,
            data: { teamNumber, pin: "654321", email: `disabled-${email}` },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await pool.query(
            "SELECT role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND u.email=$2",
            [orgId, email],
          )
        ).rows[0]?.role,
      ).toBe("scout");
      const foreign = await invited.request.get(
        "/api/scouting/free-reports?orgId=6925a000-0000-4000-8000-000000000001",
      );
      expect(foreign.status()).toBe(403);
    } finally {
      await Promise.allSettled([
        platform.close(),
        owner.close(),
        invited.close(),
      ]);
      if (orgId) {
        await pool.query(
          "DELETE FROM admin_actions WHERE target_org_id=$1 AND EXISTS(SELECT 1 FROM organizations WHERE id=$1 AND name=$2)",
          [orgId, marker],
        );
        await pool.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [
          orgId,
          marker,
        ]);
      }
      await pool.query("DELETE FROM users WHERE email=$1", [email]);
      await pool.end();
    }
  });
