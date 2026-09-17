"use client";

import { useState } from "react";
import { Button } from "../../../components/ui";
import {
  CONNECTOR_LIFECYCLE,
  CONNECTOR_SAFETY,
  CONNECTOR_STEPS,
} from "../../../lib/cad/claude-connector-steps";

/**
 * How to drive CAD from Claude Code, in the order it actually works.
 *
 * Folded away by default. Most of the team will never open a terminal, and for
 * them this is noise on a page they came to for a connect button. The people
 * who need it are looking for it.
 */
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cc-command">
      <code>{command}</code>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={() => {
          // Clipboard access is refused in some locked-down school browsers and
          // over plain http. The command is on screen either way, so a failure
          // just means it gets typed.
          void navigator.clipboard
            ?.writeText(command)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ClaudeConnectorWalkthrough() {
  return (
    <details className="cc-walkthrough">
      <summary>
        <strong>Drive CAD from Claude Code</strong>
        <span>Five steps, once per computer</span>
      </summary>

      <p className="cc-safety">{CONNECTOR_SAFETY}</p>

      <ol className="cc-steps">
        {CONNECTOR_STEPS.map((step) => (
          <li key={step.id}>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            {step.command ? <CommandLine command={step.command} /> : null}
            {step.gotcha ? <p className="cc-gotcha">{step.gotcha}</p> : null}
          </li>
        ))}
      </ol>

      {/* The question everyone asks afterwards, and the answer is not the same
          for both CAD tools. Answering only half of it is how people leave a
          window open forever, or close the one that mattered. */}
      <section className="cc-lifecycle">
        <h3>Does it have to stay open?</h3>
        <div>
          <h4>{CONNECTOR_LIFECYCLE.onshape.title}</h4>
          <p>{CONNECTOR_LIFECYCLE.onshape.body}</p>
        </div>
        <div>
          <h4>{CONNECTOR_LIFECYCLE.fusion.title}</h4>
          <p>{CONNECTOR_LIFECYCLE.fusion.body}</p>
          <CommandLine command={CONNECTOR_LIFECYCLE.fusion.command} />
        </div>
      </section>
    </details>
  );
}
