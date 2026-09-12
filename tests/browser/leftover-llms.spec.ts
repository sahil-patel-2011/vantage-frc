import { expect, test } from "@playwright/test";

test("leftover llms.txt drops TBA/Statbotics student copy", async ({ request }) => {
  test.setTimeout(90_000);
  const response = await request.get("/llms.txt");
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).not.toMatch(/TBA\/Statbotics/);
  expect(body).not.toMatch(/\bTBA\b/);
  expect(body).not.toMatch(/Statbotics/);
  expect(body).not.toMatch(/The Blue Alliance/);
  expect(body).not.toMatch(/\bFMEA\b/);
  expect(body).toMatch(/official matches/);
  expect(body).toMatch(/Failure log/);
});

test("leftover llms-full.txt drops FMEA and Onshape OAuth", async ({ request }) => {
  test.setTimeout(90_000);
  const response = await request.get("/llms-full.txt");
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).not.toMatch(/\bFMEA\b/);
  expect(body).not.toMatch(/Onshape OAuth/);
  expect(body).not.toMatch(/setup required/i);
  expect(body).toMatch(/Failure log/);
  expect(body).toMatch(/Connect Onshape/);
});

test("leftover CAD feature page drops Onshape OAuth", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/features/cad");
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).toContainText(/CAD starts|Connect Onshape|Sign in/i);
  await expect(page.locator("body")).not.toContainText("Onshape OAuth");
  await expect(page.locator("body")).not.toContainText("hosted OAuth");
  await expect(page.locator("body")).not.toContainText("FMEA");
});
