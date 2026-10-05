import type { Page } from "@playwright/test";

// UI fixtures run the actual Home and its action provider without depending on
// a local database. They assert request contracts, not database persistence.
export async function workspace(page: Page, role = "owner", match = false) {
  const layout = [
    { i: "tasks", type: "team_todos", x: 0, y: 0, w: 6, h: 4 },
    { i: "hours", type: "hours_month", x: 6, y: 0, w: 3, h: 4 },
    { i: "chat", type: "team_chat", x: 9, y: 0, w: 3, h: 4 },
  ];
  const items = [{ id: "task-1", title: "Check the robot battery", status: "todo", assigneeName: "Alex", dueOn: null }];
  if (match) {
    for (const item of layout) item.y += 5;
    layout.unshift({ i: "next-match", type: "next_match", x: 0, y: 0, w: 12, h: 5 });
  }
  const taskWrites: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { status: "empty", items: [] };
    if (path === "/api/me") body = {
      authenticated: true, userId: "ui-user", firstName: "Alex", name: "Alex", orgId: "ui-team", orgName: "Circuit Breakers", teamNumber: 6925,
      role, teamRole: "student", tbaConfigured: true, memberships: [{ orgId: "ui-team", orgName: "Circuit Breakers", teamNumber: 6925, role }],
    };
    if (path === "/api/dashboards") body = {
      role, canShareOrg: role === "owner", boards: [{ id: "ui-board", name: "My Home", scope: "personal", isActive: true }],
      active: { id: "ui-board", name: "My Home", scope: "personal", layout },
      context: { setupRequired: false, tbaConfigured: true, hasScoutingSchemas: match, eventName: match ? "Test regional" : null, homeStrip: { items: [] } },
      widgets: {
        team_todos: { type: "team_todos", status: "live", data: { open: items.length, mine: 1, items } },
        hours_month: { type: "hours_month", status: "live", data: { hours: 12.5 } },
        team_chat: { type: "team_chat", status: "live", data: { unread: 2, channels: [{ title: "Build crew", unread: 2 }] } },
        ...(match ? { next_match: { type: "next_match", status: "live", data: {
          compLevel: "qm", matchNumber: 12, ourAlliance: "red", partners: ["254", "118"], opponents: ["1114", "2056", "971"], scheduledTime: new Date(Date.now() + 600_000).toISOString(),
        } } } : {}),
      },
    };
    if (path === "/api/todos" && route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      taskWrites.push(payload);
      items.push({ id: "task-2", title: payload.title, status: "todo", assigneeName: "Alex", dueOn: null });
      body = { status: "live" };
    }
    await route.fulfill({ json: body });
  });
  return taskWrites;
}
