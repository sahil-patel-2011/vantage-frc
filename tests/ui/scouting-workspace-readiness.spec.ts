import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, schema, userId } from "./fixture";

// Hosted acceptance sources only. Repository policy prohibits running these on the laptop.
for (const width of [390, 768, 1440]) test(`publication stays in one place and preview preserves phase answers at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 950 });
  await isolateUi(page, context);
  await page.route("**/api/scouting/schemas?**", route => route.fulfill({ json: {
    userId, year: 2026, eventKey: "2026test", canManageSchemas: true,
    schemas: [{ ...schema, type: "match", definition: { title: "Competition form", fields: [
      { key: "auto", label: "Auto score", type: "number", required: true },
      { key: "teleop", label: "Teleop score", type: "number" },
    ] } }],
  } }));
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  const builder = page.locator(".sfb-page");
  await builder.getByRole("combobox", { name: "Form type", exact: true }).selectOption("match");
  await builder.getByLabel("Form title", { exact: true }).fill("Competition form revised");
  const publication = builder.getByRole("group", { name: "Form publication", exact: true });
  await expect(publication.locator(".app-button.primary")).toHaveCount(1);
  await builder.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(publication.locator(".app-button.primary")).toHaveCount(1);
  const preview = builder.getByLabel("Phone preview of the scout form", { exact: true });
  await expect(preview.getByRole("tab", { name: "Before match", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(preview.getByLabel("Auto score", { exact: true })).toHaveCount(0);
  await preview.getByRole("tab", { name: "Auto", exact: true }).click();
  await preview.getByLabel("Auto score", { exact: true }).fill("0");
  await preview.getByRole("tab", { name: "Teleop", exact: true }).click();
  await preview.getByLabel("Teleop score", { exact: true }).fill("12");
  await preview.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(preview.getByLabel("Auto score", { exact: true })).toHaveValue("0");
  await expect(preview.getByLabel("Teleop score", { exact: true })).toHaveValue("12");
  await expect(preview.getByRole("tab", { name: "All", exact: true })).toHaveCount(0);
  await accessible(page, ".sfb-page");
});

test("People starts with members and preserves filters when switching views", async ({ page, context }) => {
  await isolateUi(page, context);
  let attendanceRequests = 0;
  await page.route("**/api/attendance?**", route => { attendanceRequests += 1; return route.fulfill({ status: 503, json: { error: "Attendance unavailable" } }); });
  await page.route("**/api/team/roster?**", route => route.fulfill({ json: { canManage: true, members: [{ userId, name: "Ada", role: "owner", you: true }] } }));
  await page.goto(`/team?tab=attendance&orgId=${orgId}&season=2026`);
  const people = page.getByRole("region", { name: "Team people", exact: true });
  await expect(people.getByRole("button", { name: "Members", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(people.getByText("Ada", { exact: false })).toBeVisible();
  expect(attendanceRequests).toBe(0);
  await people.getByRole("button", { name: "Attendance", exact: true }).click();
  await expect(page).toHaveURL(/season=2026.*view=attendance/);
  await expect.poll(() => attendanceRequests).toBe(1);
  await page.goBack();
  await expect(people.getByRole("button", { name: "Members", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(people.getByRole("button", { name: "Invite people", exact: true })).toBeVisible();
});

test("a failed roster request never masquerades as missing permission", async ({ page, context }) => {
  await isolateUi(page, context);
  await page.route("**/api/team/roster?**", route => route.fulfill({ status: 503, json: { error: "Team service unavailable" } }));
  await page.goto(`/team?tab=attendance&view=access&orgId=${orgId}`);
  await expect(page.getByRole("heading", { name: "Could not check team access", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team access required", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Return to members to retry", exact: true }).click();
  await page.route("**/api/team/roster?**", route => route.fulfill({ json: { canManage: false, members: [{ userId, name: "Ada", role: "scout", you: true }] } }));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("region", { name: "Team people", exact: true }).getByText("Ada", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite people", exact: true })).toHaveCount(0);
});

test("failed attendance saves preserve the draft across People views", async ({ page, context }) => {
  await isolateUi(page, context);
  await page.route("**/api/team/roster?**", route => route.fulfill({ json: { canManage: true, members: [{ userId, name: "Ada", role: "owner", you: true }] } }));
  await page.route("**/api/attendance?**", route => route.fulfill({ json: {
    status: "ready", context: { orgId, userId, orgName: "Acceptance team", teamNumber: 6925, role: "owner", canManage: true },
    events: [], members: [], seasons: [2026], seasonYear: 2026,
  } }));
  await page.route("**/api/attendance", route => route.fulfill({ status: 503, json: { error: "Attendance save unavailable" } }));
  await page.goto(`/team?tab=attendance&view=attendance&orgId=${orgId}`);
  await page.getByRole("button", { name: "New roll call", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Practice with the drive team");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Attendance save unavailable");
  await expect(title).toHaveValue("Practice with the drive team");
  const views = page.getByRole("navigation", { name: "People view", exact: true });
  await views.getByRole("button", { name: "Members", exact: true }).click();
  await views.getByRole("button", { name: "Attendance", exact: true }).click();
  await expect(title).toHaveValue("Practice with the drive team");
});
