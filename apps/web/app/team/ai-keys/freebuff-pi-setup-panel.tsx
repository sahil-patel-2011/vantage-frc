"use client";

import {
  FREEBUFF_PI_SETUP_HEADLINE,
  FREEBUFF_PI_SETUP_INTRO,
  FREEBUFF_PI_SETUP_STEPS,
  NORMAL_TEAM_AI_PATH,
} from "../../../lib/ai-keys/freebuff-pi-setup";

export function FreebuffPiSetupPanel({ granted }: { granted: boolean }) {
  if (!granted) {
    return (
      <section className="app-card soft-panel ai-funding-panel" aria-labelledby="ai-normal-path-title">
        <h2 id="ai-normal-path-title">How teams without Free AI run models</h2>
        <p className="app-muted">{NORMAL_TEAM_AI_PATH}</p>
      </section>
    );
  }

  return (
    <section className="app-card soft-panel ai-funding-panel" aria-labelledby="freebuff-pi-setup-title">
      <h2 id="freebuff-pi-setup-title">{FREEBUFF_PI_SETUP_HEADLINE}</h2>
      <p className="app-muted">{FREEBUFF_PI_SETUP_INTRO}</p>
      <ol className="freebuff-pi-steps">
        {FREEBUFF_PI_SETUP_STEPS.map((step) => (
          <li key={step.id}>
            <div>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </div>
            {step.href ? (
              <a className="app-button secondary" href={step.href} target="_blank" rel="noreferrer">
                Open Freebuff
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
