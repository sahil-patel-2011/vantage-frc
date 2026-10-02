import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

const orgId = "6925a000-0000-4000-8000-000000000001";
test.use({ actionTimeout: 15_000 });
for (const width of [1440, 390]) test(`board create, edit, rename, copy and reload persist at ${width}px`, async ({ page, context }) => {
  test.setTimeout(120_000);
  expect(await signInAs(context, "owner")).toBe(true);
  await page.setViewportSize({ width, height: 900 });
  const initial = await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json();
  const createdIds: string[] = [];
  const name = `Board persistence ${Date.now()}`;
  const write = () => page.waitForResponse(response => response.url().endsWith("/api/dashboards") && response.request().method() === "POST");
  try {
    await page.goto(`/dashboard?orgId=${orgId}`);
    await page.getByTestId("dash-board-chip").click();
    await page.getByTestId("dash-new-board").click();
    await page.getByTestId("dash-new-board-name").fill(name);
    const create = write();
    await page.getByTestId("dash-new-board-create").click();
    const created = await (await create).json();
    expect(created.id).toBeTruthy(); createdIds.push(created.id);
    await expect(page.getByTestId("dash-edit-toolbar")).toBeVisible();
    await page.getByTestId("dash-size-toggle").first().click();
    await expect(page.getByTestId("dash-remove-widget").first()).toBeVisible();
    const original = await (await context.request.get(`/api/dashboards?orgId=${orgId}&boardId=${created.id}`)).json();
    await page.getByTestId("dash-remove-widget").first().click();
    const save = write();
    await page.getByTestId("dash-edit-done").click();
    expect((await save).ok()).toBe(true);
    await expect(page.getByTestId("dash-edit-toolbar")).toHaveCount(0);
    const saved = await (await context.request.get(`/api/dashboards?orgId=${orgId}&boardId=${created.id}`)).json();
    expect(saved.active.layout.length).toBe(original.active.layout.length - 1);
    await page.reload();
    await expect(page.getByTestId("dash-board-chip")).toContainText(name);
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.layout).toEqual(saved.active.layout);
    await page.getByTestId("dash-board-chip").click();
    await page.getByTestId("dash-manage-boards").click();
    const dialog = page.getByRole("dialog", { name: "Your boards" });
    const row = dialog.locator("li").filter({ hasText: name });
    await row.getByRole("button", { name: "Rename", exact: true }).click();
    const renamed = `${name} renamed`;
    const editingRow = dialog.locator("li").filter({ has: page.getByLabel("Board name", { exact: true }) });
    await editingRow.getByLabel("Board name").fill(renamed);
    const rename = write(); await editingRow.getByRole("button", { name: "Save", exact: true }).click();
    expect((await rename).ok()).toBe(true);
    await expect(row).toContainText(renamed);
    const duplicate = write(); await row.getByTestId("dash-duplicate-board").click();
    const copied = await (await duplicate).json(); createdIds.push(copied.id);
    expect(copied.layout).toEqual(saved.active.layout);
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("dash-board-chip")).toContainText(copied.name);
    await page.getByTestId("dash-board-chip").click();
    await page.getByRole("menuitemradio", { name: renamed, exact: true }).click();
    await expect(page.getByTestId("dash-board-chip")).toContainText(renamed);
    await page.reload();
    await expect(page.getByTestId("dash-board-chip")).toContainText(renamed);
    expect((await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).active.id).toBe(created.id);
    // Delete through the same UI: only this temporary copy is affected.
    await page.getByTestId("dash-board-chip").click(); await page.getByTestId("dash-manage-boards").click();
    await dialog.getByRole("button", { name: `Delete ${copied.name}`, exact: true }).click();
    await page.getByRole("dialog", { name: `Delete “${copied.name}”?` }).getByRole("button", { name: `Delete ${copied.name}`, exact: true }).click();
    await expect.poll(async () => (await (await context.request.get(`/api/dashboards?orgId=${orgId}`)).json()).boards.some((board: { id: string }) => board.id === copied.id)).toBe(false);
  } finally {
    for (const id of createdIds) await context.request.delete("/api/dashboards", { data: { orgId, id } });
    if (initial.active.id) await context.request.post("/api/dashboards", { data: { orgId, id: initial.active.id, action: "activate" } });
  }
});
