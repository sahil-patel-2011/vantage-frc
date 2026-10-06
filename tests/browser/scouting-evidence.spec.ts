import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { signInAs } from "./session";
const orgId = "6925a000-0000-4000-8000-000000000001";

test("shared reports travel through the real API and disappear after owner opt-out", async ({
  page,
  browser,
}) => {
  const connectionString = process.env.DATABASE_ADMIN_URL;
  expect(connectionString, "isolated fixture admin URL").toBeTruthy();
  const url = new URL(connectionString!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname.slice(1)).toMatch(/(?:^|[_-])(test|ci)(?:[_-]|$)/i);
  const pool = new Pool({ connectionString, ssl: false });
  const sourceOrg = randomUUID(),
    schema = randomUUID();
  const sourceUser = "6925e2e0-0000-4000-8000-000000000002";
  const sourceContext = await browser.newContext();
  try {
    const subject = await pool.query(
      "SELECT event_key,match_key,team_key FROM match_scout_entries WHERE org_id=$1 AND team_key='frc254' LIMIT 1",
      [orgId],
    );
    expect(subject.rowCount).toBe(1);
    const row = subject.rows[0];
    await pool.query(
      "INSERT INTO organizations(id,name,slug,team_number) VALUES($1::uuid,'Synthetic shared scouting',$1::text,99996)",
      [sourceOrg],
    );
    await pool.query(
      "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
      [sourceOrg, sourceUser],
    );
    await pool.query(
      "INSERT INTO org_auth_policies(org_id,allow_password) VALUES($1,true) ON CONFLICT(org_id) DO UPDATE SET allow_password=true",
      [sourceOrg],
    );
    await pool.query(
      "INSERT INTO scout_schemas(id,org_id,year,type,version,schema,created_by) VALUES($1,$2,2026,'match',1,$3,$4)",
      [
        schema,
        sourceOrg,
        JSON.stringify({
          fields: [
            { key: "cycles", label: "Synthetic cycles", type: "counter" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        }),
        sourceUser,
      ],
    );
    await pool.query(
      "INSERT INTO match_scout_entries(org_id,event_key,match_key,team_key,schema_id,scout_user_id,payload,client_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        sourceOrg,
        row.event_key,
        row.match_key,
        row.team_key,
        schema,
        sourceUser,
        JSON.stringify({
          cycles: 7,
          notes: "PRIVATE NETWORK TEST",
          _scoutIdentity: { name: "PRIVATE NETWORK TEST" },
        }),
        randomUUID(),
      ],
    );
    const endpoint =
      "/api/scouting/shared?" +
      new URLSearchParams({
        orgId,
        teamKey: row.team_key,
        eventKey: row.event_key,
      });
    await page.goto("/scout/teams?orgId=" + orgId + "&team=254");
    const initial = await page.request.get(endpoint);
    expect(initial.status()).toBe(200);
    const shared = await initial.json();
    expect(
      shared.rows.find(
        (item: { sourceOrgId: string }) => item.sourceOrgId === sourceOrg,
      ).payload,
    ).toEqual({ cycles: 7 });
    expect(JSON.stringify(shared)).not.toContain("PRIVATE NETWORK TEST");
    await page
      .getByText("Shared scouting from other teams", { exact: true })
      .click();
    await expect(
      page.getByText("Source: Team 99996 · form v1", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Synthetic cycles 7/ }),
    ).toBeVisible();
    expect(await signInAs(sourceContext, "member")).toBe(true);
    const blocked = await page.request.post("/api/scouting/sharing", {
      headers: { origin: new URL(page.url()).origin },
      data: { orgId: sourceOrg, enabled: false },
    });
    expect(blocked.status()).toBe(403);
    const changed = await sourceContext.request.post(
      new URL("/api/scouting/sharing", page.url()).href,
      {
        headers: { origin: new URL(page.url()).origin },
        data: { orgId: sourceOrg, enabled: false },
      },
    );
    expect(changed.status()).toBe(200);
    expect(
      (await (await page.request.get(endpoint)).json()).rows.some(
        (item: { sourceOrgId: string }) => item.sourceOrgId === sourceOrg,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Refresh shared scouting", exact: true })
      .click();
    await expect(
      page.getByText("Source: Team 99996 · form v1", { exact: false }),
    ).toHaveCount(0);
  } finally {
    await sourceContext.close();
    await pool.query(
      "DELETE FROM organizations WHERE id=$1 AND name='Synthetic shared scouting'",
      [sourceOrg],
    );
    await pool.end();
  }
});
test.beforeEach(async ({ context }) => {
  expect(await signInAs(context, "owner"), "real fixture sign-in").toBe(true);
});

for (const width of [390, 1280]) {
  test("scouting evidence is usable at " + width + "px", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/scout/teams?orgId=" + orgId + "&team=254");
    const results = page.getByRole("region", {
      name: "Scouting results",
      exact: true,
    });
    await expect(results).toBeVisible({ timeout: 60000 });
    expect(pageErrors, "Direct robot links hydrate without resetting the selected view").toEqual([]);
    await expect(results.getByText(/Source: your team/)).toBeVisible();
    await results.locator(".intel-sb-head").first().click();
    await expect(results.getByRole("table")).toBeVisible();
    await expect(
      results.getByText(/Missing answers are excluded/),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include(".intel-observation-explorer").analyze()).violations,
    ).toEqual([]);
    const match = results.getByRole("combobox", { name: "Match", exact: true });
    const option = await match.locator("option").nth(1).getAttribute("value");
    expect(option).toBeTruthy();
    await match.selectOption(option!);
    await expect(results.getByText(/1 unique matches/).first()).toBeVisible();
    await results
      .getByRole("button", { name: "Match reports", exact: true })
      .click();
    await expect(
      results.getByRole("heading", { name: "Original match reports" }),
    ).toBeVisible();
    await results.locator(".intel-report-list summary").first().click();
    await expect(results.locator("dl").first()).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include(".intel-observation-explorer").analyze()).violations,
    ).toEqual([]);
    await results
      .getByRole("button", { name: "Private notes", exact: true })
      .click();
    await expect(
      results.getByText("Visible to your team. Excluded from shared scouting."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const scan = await new AxeBuilder({ page })
      .include(".intel-observation-explorer")
      .analyze();
    expect(scan.violations).toEqual([]);
    await results
      .getByRole("button", { name: "Capabilities", exact: true })
      .click();
    await match.selectOption("");
    await page.keyboard.press("Control+Home");
    await page.screenshot({
      path: test.info().outputPath("scouting-" + width + ".png"),
      fullPage: false,
    });
  });
}

test("owner can change the real sharing setting and restore it", async ({
  page,
}) => {
  await page.goto("/scout?orgId=" + orgId);
  await page.getByText("Scouting network and sharing", { exact: true }).click();
  const card = page.getByRole("region", {
    name: "Scouting sharing",
    exact: true,
  });
  await expect(card).toBeVisible({ timeout: 60000 });
  const toggle = card.getByRole("button", { name: /Turn sharing (on|off)/ });
  await expect(toggle).toBeVisible();
  const original = await toggle.innerText();
  try {
    await toggle.click();
    await expect(toggle).toHaveText(
      original === "Turn sharing off" ? "Turn sharing on" : "Turn sharing off",
    );
    const current = await page.request.get(
      "/api/scouting/sharing?orgId=" + orgId,
    );
    expect(current.ok()).toBe(true);
    expect((await current.json()).enabled).toBe(
      original !== "Turn sharing off",
    );
  } finally {
    if ((await toggle.innerText()) !== original) {
      await toggle.click();
      await expect(toggle).toHaveText(original);
    }
  }
});

test("a scout can inspect sharing but cannot change it", async ({
  context,
  page,
}) => {
  expect(await signInAs(context, "member")).toBe(true);
  await page.goto("/scout?orgId=" + orgId);
  await page.getByText("Scouting network and sharing", { exact: true }).click();
  const card = page.getByRole("region", {
    name: "Scouting sharing",
    exact: true,
  });
  await expect(card.getByText(/Sharing is (on|off) for your team/)).toBeVisible(
    { timeout: 60000 },
  );
  await expect(card.getByRole("button", { name: /Turn sharing/ })).toHaveCount(
    0,
  );
  const response = await page.request.post("/api/scouting/sharing", {
    headers: { origin: new URL(page.url()).origin },
    data: { orgId, enabled: false },
  });
  expect(response.status()).toBe(403);
});
