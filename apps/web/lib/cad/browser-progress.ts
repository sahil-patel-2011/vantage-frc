/** A returned click is not proof that the intended geometry exists. */
export function browserActionProgress(result: unknown, postconditionRequested: boolean): { pause: boolean; message: string } {
  const row = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  const performed = row?.actionPerformed === true;
  const verified = performed && row?.status === "verified" && row.verification === "ui-postcondition";
  const requiresInspection = row?.requiresInspection === true;
  return {
    pause: requiresInspection || !performed || (postconditionRequested && !verified),
    message: requiresInspection ? (typeof row?.message === "string" && row.message.trim() ? row.message.slice(0, 2000) : "The browser changed unexpectedly. Inspect it before continuing.")
      : verified ? "UI check passed. Geometry still requires measurement."
      : performed ? "Action performed; its result still needs verification."
        : "The tool returned without confirming a performed action. Inspect the current view.",
  };
}
