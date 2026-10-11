import { after } from "next/server";

/**
 * Run outage bookkeeping after the response is sent. `after()` only works inside a request;
 * anywhere else (a script, a unit test) the task runs now, in the background. Never throws.
 */
export function deferOutageWork(task: () => Promise<unknown>): void {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}
