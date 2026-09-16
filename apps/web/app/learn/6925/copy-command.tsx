"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui";

/**
 * A command a student pastes into a terminal, with a copy button.
 *
 * Retyping a URL by hand is where this goes wrong, so the command is selectable
 * as well as copyable — clipboard access is blocked in some school-managed
 * browsers, and the fallback there is being able to drag-select the text, not a
 * dead button. The result is announced rather than shown only in colour.
 */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2400);
  }

  return (
    <div className="lab-command">
      {label ? <span className="app-muted">{label}</span> : null}
      <div className="lab-command-row">
        <code>{command}</code>
        <Button variant="secondary" size="sm" type="button" onClick={copy}>
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <span role="status" className="app-muted lab-command-status">
        {state === "copied"
          ? "Copied. Paste it into PowerShell and press Enter."
          : state === "failed"
            ? "Could not reach the clipboard — select the command above and copy it."
            : ""}
      </span>
    </div>
  );
}
