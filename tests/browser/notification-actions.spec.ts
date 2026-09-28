import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";

const homeOrg = "6925a000-0000-4000-8000-000000000001";
const ownerId = "6925e2e0-0000-4000-8000-000000000001";
const memberId = "6925e2e0-0000-4000-8000-000000000002";

test("notification counts follow the team, opening clears seen items, and changes are authorized", async ({ page, context }) => {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/test|ci/);
  const pool = new Pool({ connectionString: url.toString(), ssl: false });
  const otherOrg = randomUUID();
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const title = `Inbox audit ${randomUUID()}`;
  await pool.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,$2,$3,99993)", [otherOrg, title, otherOrg]);
  try {
    await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')", [otherOrg, ownerId]);
    expect(await signInAs(context, "owner")).toBe(true);
    const baseline = await (await context.request.get(`/api/me?orgId=${homeOrg}`)).json();
    for (const [i, user, org, type, payload] of [
      [0, ownerId, homeOrg, "release", { title }],
      [1, ownerId, null, "release", { title: `${title} global` }],
      [2, ownerId, otherOrg, "release", { title: `${title} other team` }],
      [3, memberId, homeOrg, "release", { title: `${title} other person` }],
      [4, ownerId, homeOrg, "team_announcement", { announcementId: randomUUID(), title: `${title} deleted` }],
    ] as const) {
      await pool.query("INSERT INTO notifications(id,user_id,org_id,type,payload) VALUES($1,$2,$3,$4,$5)", [ids[i], user, org, type, JSON.stringify(payload)]);
    }
    const session = await (await context.request.get(`/api/me?orgId=${homeOrg}`)).json();
    expect(session.unreadNotificationCount).toBe(baseline.unreadNotificationCount + 2);
    expect((await context.request.get(`/api/me?orgId=${randomUUID()}`)).status()).toBe(403);
    const rejected = await context.request.patch("/api/notifications", { data: { orgId: homeOrg, action: "read", ids: [ids[0], ids[3]] } });
    expect(rejected.status()).toBe(400);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=ANY($1::uuid[])", [[ids[0], ids[3]]])).rows.every((row) => row.read_at === null)).toBe(true);
    expect((await context.request.patch("/api/notifications", { data: { orgId: homeOrg, action: "read", ids: [ids[2]] } })).status()).toBe(400);

    await page.goto(`/dashboard?orgId=${homeOrg}`);
    await expect(page.locator(".soft-notif")).toHaveAttribute("aria-label", `Notifications, ${session.unreadNotificationCount} unread`);
    await page.locator(".soft-notif").click();
    const inbox = page.getByRole("list", { name: "Inbox" });
    await expect(inbox).toContainText(title);
    // Acknowledgment follows actual visibility; scroll both scoped rows into view.
    for (const [id, label] of [[ids[0], title], [ids[1], `${title} global`]] as const) {
      await inbox.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
      await expect.poll(async () => (await pool.query("SELECT read_at FROM notifications WHERE id=$1", [id])).rows[0].read_at).not.toBeNull();
    }
    await expect(page.locator(".soft-notif")).toHaveAttribute("aria-label", "Notifications");
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1", [ids[4]])).rows[0].read_at).toBeNull();
    const row = page.getByRole("list", { name: "Inbox" }).getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
    await row.getByRole("button", { name: /as unread/ }).click();
    await expect(page.locator(".soft-notif")).toHaveAttribute("aria-label", "Notifications, 1 unread");
    await page.getByRole("button", { name: "Mark all as read", exact: true }).click();
    await expect(page.locator(".soft-notif")).toHaveAttribute("aria-label", "Notifications");
    await page.reload();
    await expect(page.locator(".soft-notif b")).toHaveCount(0);
    const remaining = await pool.query("SELECT id FROM notifications WHERE id=ANY($1::uuid[]) AND read_at IS NULL", [ids]);
    expect(remaining.rows.map((row) => row.id).sort()).toEqual(ids.slice(2, 4).sort());
  } finally {
    await pool.query("DELETE FROM notifications WHERE id=ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM organizations WHERE id=$1 AND name=$2", [otherOrg, title]);
    await pool.end();
  }
});
