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
  expect(body).toMatch(/official matches/);
});
