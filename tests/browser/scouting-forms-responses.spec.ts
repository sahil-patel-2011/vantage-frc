import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";
const orgId = "6925a000-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });

for (const width of [1440, 390]) test(`published pit form collects real answers, cancels safely and charts responses at ${width}px`, async ({ page, context }, info) => {
  test.setTimeout(150_000);
  expect(await signInAs(context, "owner")).toBe(true);
  const pool = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const previous = (await pool.query("SELECT active_event_key FROM org_active_context WHERE org_id=$1", [orgId])).rows[0].active_event_key;
  const marker = `Pit response ${randomUUID()}`;
  let schemaId = "";
  let revisedId = "";
  try {
    await pool.query("UPDATE org_active_context SET active_event_key=NULL WHERE org_id=$1", [orgId]);
    const definition = { title: marker, fields: [
      { key: "cycles", label: "Cycle count", type: "number", required: true, config: { chart: "trend" } },
      { key: "drive", label: "Drivetrain", type: "select", options: ["Swerve", "Tank"], config: { chart: "bar" } },
      { key: "notes", label: "Notes", type: "text", widget: "short" },
    ] };
    const before = await (await context.request.get(`/api/scouting/schemas?orgId=${orgId}&year=2026`)).json();
    const created = await context.request.post("/api/scouting/schemas", { data: { orgId, year: 2026, type: "pit", baseSchemaId: before.schemas.find((entry: {type:string;id:string}) => entry.type === "pit")?.id ?? null, definition } });
    expect(created.status()).toBe(201); schemaId = (await created.json()).id;
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/competition?tab=scouting&mode=free&orgId=${orgId}`);
    await expect(page.getByRole("radio", { name: "Pit", exact: true })).toBeChecked();
    await expect(page.getByLabel("Match name", { exact: true })).toHaveCount(0);
    await page.getByLabel("Team number", { exact: true }).fill("98765");
    await page.getByRole("combobox", { name: "Questions", exact: true }).selectOption(schemaId);
    await page.getByRole("button", { name: "Start scouting", exact: true }).click();
    await page.getByRole("button", { name: "Save report", exact: true }).click();
    await expect(page.locator(".free-scout-card").first()).toContainText("Cycle count");
    expect((await pool.query("SELECT id FROM free_scout_reports WHERE org_id=$1 AND definition->>'title'=$2", [orgId, marker])).rows).toHaveLength(0);
    await page.getByRole("spinbutton", { name: /^Cycle count/ }).fill("0");
    await page.getByRole("radio", { name: "Swerve", exact: true }).click();
    await page.getByRole("radio", { name: "Swerve", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Tank", exact: true })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Swerve", exact: true })).toBeChecked();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Cancel report", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start scouting", exact: true })).toBeVisible();
    expect((await pool.query("SELECT id FROM free_scout_reports WHERE org_id=$1 AND definition->>'title'=$2", [orgId, marker])).rows).toHaveLength(0);
    await page.getByRole("button", { name: "Start scouting", exact: true }).click();
    await page.getByRole("spinbutton", { name: /^Cycle count/ }).fill("0");
    await page.getByRole("radio", { name: "Swerve", exact: true }).click();
    await page.getByRole("textbox", { name: "Notes", exact: true }).fill(marker);
    expect((await new AxeBuilder({ page }).include(".free-scout").analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`pit-form-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Save report", exact: true }).click();
    await expect.poll(async () => (await pool.query("SELECT payload FROM free_scout_reports WHERE org_id=$1 AND definition->>'title'=$2", [orgId, marker])).rows, { timeout: 30_000 }).toEqual([{ payload: { cycles: 0, drive: "Swerve", notes: marker } }]);
    const response = await context.request.get(`/api/scouting/form-responses?orgId=${orgId}&schemaId=${schemaId}`);
    expect(response.ok()).toBe(true);
    expect((await response.json()).rows.filter((row: { payload: { notes?: string } }) => row.payload.notes === marker)).toHaveLength(1);
    const revised = await context.request.post("/api/scouting/schemas", { data: { orgId, year: 2026, type: "pit", baseSchemaId: schemaId, definition: { ...definition, fields: [...definition.fields, { key: "added", label: "New question", type: "text" }] } } });
    expect(revised.status()).toBe(201); revisedId = (await revised.json()).id;
    const history = await (await context.request.get(`/api/scouting/form-responses?orgId=${orgId}&schemaId=${revisedId}`)).json();
    expect(history.rows.find((row: { payload: { notes?: string } }) => row.payload.notes === marker).payload).toEqual({ cycles: 0, drive: "Swerve", notes: marker });
    expect(history.definition.fields.some((field: { key: string }) => field.key === "added")).toBe(true);
    const alien = await context.request.get(`/api/scouting/form-responses?orgId=${randomUUID()}&schemaId=${schemaId}`);
    expect(alien.status()).toBe(403);
    await page.goto(`/competition?tab=forms&orgId=${orgId}`);
    const workspace = page.getByRole("navigation", { name: "Form workspace" });
    await workspace.getByRole("button", { name: "Responses", exact: true }).click();
    await page.locator(".sfb-responses").getByLabel("Team number", { exact: true }).fill("98765");
    await expect(page.locator(".sfb-responses")).toContainText("1 response");
    await expect(page.locator(".sfb-response-charts")).toContainText("Average 0.0");
    await page.getByRole("navigation", { name: "Response view" }).getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.getByRole("table")).toContainText(marker);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("scouting-responses.csv");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include(".sfb-page").analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`responses-${width}.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    expect((await new AxeBuilder({ page }).include(".sfb-page").analyze()).violations).toEqual([]);
    await page.goto(`/account/teams?orgId=${orgId}`);
    await expect(page.getByRole("heading", { name: "Your teams", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create a team", exact: true })).toHaveAttribute("href", "/claim");
    await page.screenshot({ path: info.outputPath(`teams-settings-${width}.png`), fullPage: true });
  } finally {
    await page.goto("/privacy");
    await pool.query("DELETE FROM free_scout_reports WHERE org_id=$1 AND definition->>'title'=$2", [orgId, marker]);
    await pool.query("DELETE FROM scout_schemas WHERE org_id=$1 AND id=ANY($2::uuid[])", [orgId, [schemaId, revisedId].filter(Boolean)]);
    await pool.query("UPDATE org_active_context SET active_event_key=$2 WHERE org_id=$1", [orgId, previous]);
    await pool.end();
  }
});
