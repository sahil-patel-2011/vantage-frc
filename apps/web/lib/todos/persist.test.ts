import { describe, expect, it, vi } from "vitest";
import { persistTodo } from "./persist";
import { enqueueOutboxItem } from "../offline";

function dependencies() {
  return { fetch: vi.fn<typeof fetch>(), enqueue: vi.fn<typeof enqueueOutboxItem>() };
}

describe("task persistence confirmation", () => {
  it("does not confirm offline storage until the write completes", async () => {
    const deps = dependencies();
    let complete!: (value: never) => void;
    deps.enqueue.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const confirmed = vi.fn();
    const request = persistTodo("team", { action: "create-todo", title: "Repair" }, false, deps).then(confirmed);
    await Promise.resolve();
    expect(confirmed).not.toHaveBeenCalled();
    complete({} as never);
    await request;
    expect(confirmed).toHaveBeenCalledWith({ kind: "queued" });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("reports storage failure instead of promising an upload", async () => {
    const deps = dependencies();
    deps.enqueue.mockRejectedValue(new Error("This browser cannot save work offline."));
    await expect(persistTodo("team", { action: "create-todo" }, false, deps)).rejects.toThrow("cannot save work offline");
  });

  it("keeps permission errors actionable", async () => {
    const deps = dependencies();
    deps.fetch.mockResolvedValue(Response.json({ error: "Ask a team admin for task access." }, { status: 403 }));
    await expect(persistTodo("team", { action: "create-todo" }, true, deps)).rejects.toThrow("Ask a team admin");
  });

  it("gives a recovery step when the network request fails", async () => {
    const deps = dependencies();
    deps.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(persistTodo("team", {}, true, deps)).rejects.toThrow("Check your connection and try again");
  });

  it("rejects setup states and malformed responses as unsuccessful writes", async () => {
    const deps = dependencies();
    deps.fetch.mockResolvedValueOnce(Response.json({ status: "setup_required", message: "Choose your team." }));
    await expect(persistTodo("team", {}, true, deps)).rejects.toThrow("Choose your team");
    deps.fetch.mockResolvedValueOnce(new Response("Unavailable", { status: 502 }));
    await expect(persistTodo("team", {}, true, deps)).rejects.toThrow("Could not save");
  });
});
