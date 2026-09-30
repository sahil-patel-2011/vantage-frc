import { enqueueOutboxItem, newOutboxClientId } from "../offline";
import type { TodosView } from "./types";

type LiveView = Extract<TodosView, { status: "live" }>;

/** A mutation is successful only after the server or device confirms storage. */
export async function persistTodo(
  orgId: string,
  payload: Record<string, unknown>,
  online: boolean,
  dependencies = { fetch: globalThis.fetch, enqueue: enqueueOutboxItem },
): Promise<{ kind: "queued" } | { kind: "saved"; view: LiveView }> {
  if (!online) {
    await dependencies.enqueue({
      clientId: newOutboxClientId(),
      feature: payload.action === "create-todo" ? "task_create" : "task_tick",
      orgId,
      payload: { ...payload, orgId },
    });
    return { kind: "queued" };
  }
  let response: Response;
  try {
    response = await dependencies.fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, orgId }),
    });
  } catch {
    throw new Error("Could not reach Vantage. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null) as TodosView | { error?: string } | null;
  if (!response.ok || !data || !("status" in data) || data.status !== "live") {
    const message = data && "error" in data && data.error
      ? data.error
      : data && "message" in data ? data.message : "Could not save the task. Please try again.";
    throw new Error(message);
  }
  return { kind: "saved", view: data };
}
