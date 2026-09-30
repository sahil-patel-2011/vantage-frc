import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { TodosView } from "../../apps/web/lib/todos/types";
import { signInAs } from "./session";

test("a rejected task keeps the draft and permits a successful retry", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.goto("/team?tab=todos");
  const form = page.locator("form.todos-create");
  const title = `Retry task ${Date.now()}`;
  await form.getByLabel("Title", { exact: true }).fill(title);
  await page.route("**/api/todos", async route => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 403, json: { error: "Ask a team admin for task access." } });
    } else await route.continue();
  });
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".todos-page").getByRole("alert")).toContainText("Ask a team admin");
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(title);
  await page.unroute("**/api/todos");
  try {
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("");
    await expect(page.locator(".todos-card").filter({ hasText: title })).toBeVisible();
  } finally {
    const identity = await (await context.request.get("/api/me")).json();
    const response = await context.request.get(`/api/todos?orgId=${identity.orgId}`);
    const view = await response.json() as TodosView;
    expect(view.status, "Task cleanup requires live data").toBe("live");
    const live = view as Extract<TodosView, { status: "live" }>;
    for (const todo of live.todos.filter(todo => todo.title === title)) {
      expect((await context.request.post("/api/todos", { data: { orgId: identity.orgId, action: "delete-todo", todoId: todo.id } })).ok()).toBe(true);
    }
  }
});

test("offline storage failure retains the task without claiming it was saved", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  await page.goto("/team?tab=todos");
  const form = page.locator("form.todos-create");
  await form.getByLabel("Title", { exact: true }).fill("Keep this offline draft");
  await page.evaluate(() => Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined }));
  await context.setOffline(true);
  try {
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.locator(".todos-page").getByRole("alert")).toContainText("cannot save work offline");
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Keep this offline draft");
    await expect(page.locator(".todos-page").getByRole("alert")).not.toContainText("Saved on this device");
  } finally {
    await context.setOffline(false);
  }
});

test("typing the next task during a save retains the new draft", async ({ page, context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const identity = await (await context.request.get("/api/me")).json();
  const title = `Pending task ${Date.now()}`;
  await page.goto(`/team?tab=todos&orgId=${identity.orgId}`);
  const form = page.locator("form.todos-create");
  await form.getByLabel("Title", { exact: true }).fill(title);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/todos", async route => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  try {
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(form.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await form.getByLabel("Title", { exact: true }).fill("The next task");
    release();
    await expect(page.locator(".todos-card").filter({ hasText: title })).toBeVisible();
    await expect(form.getByLabel("Title", { exact: true })).toHaveValue("The next task");
  } finally {
    release();
    await page.unroute("**/api/todos");
    const view = await (await context.request.get(`/api/todos?orgId=${identity.orgId}`)).json() as TodosView;
    expect(view.status).toBe("live");
    for (const todo of (view as Extract<TodosView, { status: "live" }>).todos.filter(todo => todo.title === title)) {
      expect((await context.request.post("/api/todos", { data: { orgId: identity.orgId, action: "delete-todo", todoId: todo.id } })).ok()).toBe(true);
    }
  }
});

for (const width of [320, 1440]) {
  test(`compact task controls preserve filters and real mutations at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const identity = await (await context.request.get("/api/me")).json();
    const orgId = identity.orgId as string;
    expect(orgId).toBeTruthy();
    const prefix = `UI controls ${width} ${Date.now()}`;
    const read = async () => {
      const response = await context.request.get(`/api/todos?orgId=${orgId}`);
      expect(response.ok()).toBe(true);
      const view = await response.json() as TodosView;
      if (view.status !== "live") throw new Error("Real task data is required");
      return view;
    };
    try {
      for (const status of ["doing", "done"] as const) {
        const response = await context.request.post("/api/todos", { data: { action: "create-todo", orgId, title: `${prefix} ${status}`, status } });
        expect(response.ok()).toBe(true);
      }
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/team?tab=todos&orgId=${orgId}`);
      const form = page.locator("form.todos-create");
      await expect(form.getByLabel("Title", { exact: true })).toBeVisible({ timeout: 30_000 });
      await form.getByLabel("Title", { exact: true }).fill(`${prefix} todo`);
      await form.locator("summary").click();
      const currentUserId = (await read()).currentUserId;
      await form.getByRole("combobox", { name: "Assignee", exact: true }).selectOption(currentUserId);
      await form.getByLabel("Due", { exact: true }).fill("2000-01-01");
      await form.getByRole("button", { name: "Add", exact: true }).click();
      await expect.poll(async () => (await read()).todos.some(todo => todo.title === `${prefix} todo`)).toBe(true);
      const view = await read();
      const created = view.todos.find(todo => todo.title === `${prefix} todo`)!;
      const card = page.locator(`[id="todo-${created.id}"]`);
      await expect(card).toBeVisible();
      await expect(card.getByRole("combobox", { name: "Status", exact: true, includeHidden: true })).toBeHidden();
      await expect(card.getByRole("button", { name: "Mark done", exact: true })).toBeVisible();

      const filter = page.getByRole("combobox", { name: "Show tasks", exact: true });
      await expect(filter.locator("option")).toHaveCount(6);
      for (const [value, statuses] of [
        ["all", ["todo", "doing", "done"]], ["mine", ["todo"]], ["todo", ["todo"]],
        ["doing", ["doing"]], ["done", ["done"]], ["overdue", ["todo"]],
      ] as const) {
        await filter.selectOption(value);
        for (const status of ["todo", "doing", "done"] as const) {
          const row = page.locator(".todos-card").filter({ hasText: `${prefix} ${status}` });
          if ((statuses as readonly string[]).includes(status)) await expect(row).toBeVisible();
          else await expect(row).toHaveCount(0);
        }
      }
      await filter.selectOption("all");
      await card.getByRole("button", { name: "Mark done", exact: true }).click();
      await expect(card.getByRole("button", { name: "Reopen", exact: true })).toBeEnabled();
      expect((await read()).todos.find(todo => todo.id === created.id)?.status).toBe("done");
      await card.getByRole("button", { name: "Reopen", exact: true }).click();
      await expect(card.getByRole("button", { name: "Mark done", exact: true })).toBeEnabled();
      await card.locator("summary").click();
      await card.getByRole("combobox", { name: "Status", exact: true }).selectOption("doing");
      await expect.poll(async () => (await read()).todos.find(todo => todo.id === created.id)?.status).toBe("doing");
      await expect(card.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
      await expect(card.getByRole("link", { name: "Link to task", exact: true })).toHaveAttribute("href", new RegExp(created.id));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const audit = await new AxeBuilder({ page }).analyze();
      await info.attach("work-accessibility.json", { body: JSON.stringify(audit), contentType: "application/json" });
      expect(audit.violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`work-${width}.png`), fullPage: true });
      page.once("dialog", dialog => dialog.dismiss());
      await card.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(card).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await card.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(card).toHaveCount(0);
      expect((await read()).todos.some(todo => todo.id === created.id)).toBe(false);
    } finally {
      for (const todo of (await read()).todos.filter(todo => todo.title.startsWith(prefix))) {
        const response = await context.request.post("/api/todos", { data: { action: "delete-todo", orgId, todoId: todo.id } });
        expect(response.ok()).toBe(true);
      }
    }
  });
}

for (const width of [390, 1440]) {
  test(`one account help destination preserves support tools at ${width}px`, async ({ page, context }, info) => {
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Account", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Account and settings", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Help and support", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "App manual", exact: true })).toHaveCount(0);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== "running"));
    const audit = await new AxeBuilder({ page }).analyze();
    await info.attach("account-accessibility.json", { body: JSON.stringify(audit), contentType: "application/json" });
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`account-${width}.png`) });
    await menu.getByRole("menuitem", { name: "Help and support", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Help centre", exact: true })).toBeVisible();
    for (const name of ["Support tickets", "Report a bug", "App manual"]) {
      await expect(page.getByRole("navigation", { name: "Related account tools" }).getByRole("link", { name, exact: true })).toBeVisible();
    }
  });
}
