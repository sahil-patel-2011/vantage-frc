"use client";

import { useState } from "react";
import { Button } from "../../components/ui";

type Step = { step: string; ok: boolean; detail?: string };

/**
 * "Run a test": one real round trip to the connected service, shown as a checklist of what
 * was tried and what happened, so "is this working?" has a direct answer.
 */
export function RunTestButton({ endpoint, body, label = "Run a test" }: { endpoint: string; body: Record<string, unknown>; label?: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ passed: boolean; steps: Step[] } | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, action: "test" }),
      });
      const data = (await response.json().catch(() => ({}))) as { passed?: boolean; steps?: Step[]; error?: string };
      setResult(
        data.steps
          ? { passed: Boolean(data.passed), steps: data.steps }
          : { passed: false, steps: [{ step: "Run the test", ok: false, detail: data.error ?? "No answer from Vantage." }] },
      );
    } catch {
      setResult({ passed: false, steps: [{ step: "Reach Vantage", ok: false, detail: "Check your connection and try again." }] });
    }
    setRunning(false);
  }

  return (
    <div className="run-test">
      <Button variant="ghost" size="sm" type="button" disabled={running} onClick={() => void run()}>
        {running ? "Testing…" : label}
      </Button>
      {result ? (
        <div className={`run-test-result${result.passed ? " passed" : " failed"}`} role="status">
          <strong>{result.passed ? "Everything works." : "Something needs fixing."}</strong>
          <ul>
            {result.steps.map((step) => (
              <li key={step.step} data-ok={step.ok}>
                <span aria-hidden="true">{step.ok ? "✓" : "✕"}</span> {step.step}
                {step.detail ? <small> — {step.detail}</small> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
