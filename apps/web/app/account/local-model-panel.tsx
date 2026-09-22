"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { LOCAL_MODELS, humanSize } from "../../lib/local-model/catalog";
import {
  consentCopy,
  downloadDecision,
  type DeviceProfile,
  type Eligibility,
} from "../../lib/local-model/eligibility";
import {
  localModelConsented,
  localModelEnabled,
  probeDevice,
  setLocalModelConsented,
  setLocalModelEnabled,
} from "../../lib/local-model/probe";

/**
 * Account → the model that runs on your own computer.
 *
 * The setting is on by default, and the panel is honest about what that does
 * and does not mean: the feature is wanted, the download still waits for a
 * machine that can run it and a connection that will not be hurt by it, and it
 * asks once before the first one.
 *
 * Everything that decides anything lives in `eligibility.ts`. This renders the
 * answer.
 */
export function LocalModelPanel() {
  const [enabled, setEnabled] = useState(true);
  const [consented, setConsented] = useState(false);
  const [device, setDevice] = useState<DeviceProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEnabled(localModelEnabled());
    setConsented(localModelConsented());
    void probeDevice().then((profile) => {
      if (cancelled) return;
      setDevice(profile);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    setLocalModelEnabled(next);
  }, []);

  const agree = useCallback(() => {
    setConsented(true);
    setLocalModelConsented(true);
  }, []);

  const forget = useCallback(() => {
    setConsented(false);
    setLocalModelConsented(false);
  }, []);

  // The model is not cached until the runtime reports it; until then this panel
  // describes what will happen rather than claiming anything has.
  const decision = device
    ? downloadDecision({ enabled, consented, cached: false, device })
    : null;

  const blocked: (Eligibility & { ok: false }) | null = decision?.blocked ?? null;

  return (
    <section className="app-card soft-panel lm-panel" aria-label="On-device model">
      <h2>Run a model on this computer</h2>
      <p className="app-muted">
        Ranking your saved notes, summarising a match, keeping a long thread tidy
        — small jobs that happen constantly. Doing them here means they are
        quicker, cost nothing, and your team&rsquo;s notes never leave this
        machine.
      </p>

      <label className="lm-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span>
          <strong>Use a local model when this computer can</strong>
          <small>
            On by default. Turning it off sends these jobs to the hosted model
            instead — nothing stops working.
          </small>
        </span>
      </label>

      {!loaded ? (
        <p className="app-muted">Checking what this computer can do…</p>
      ) : blocked ? (
        <p className="lm-blocked" role="status">
          {blocked.reason}
        </p>
      ) : decision?.prompt ? (
        <div className="lm-consent">
          <p>{consentCopy(LOCAL_MODELS[0]!)}</p>
          <div className="lm-consent-actions">
            <Button type="button" onClick={agree}>
              Download it
            </Button>
            <Button variant="secondary" type="button" onClick={() => toggle(false)}>
              Not on this computer
            </Button>
          </div>
        </div>
      ) : enabled ? (
        <p className="lm-ready" role="status">
          Ready. The model loads in the background the next time you open a page
          that needs it.
          <Button variant="secondary" size="sm" type="button" onClick={forget}>
            Ask me again
          </Button>
        </p>
      ) : null}

      <details className="lm-models">
        <summary>Which model, and why</summary>
        <ul>
          {LOCAL_MODELS.map((model) => (
            <li key={model.id}>
              <strong>{model.label}</strong>
              <small>
                {model.parameters} · {humanSize(model.downloadMb)} download ·{" "}
                {model.licence}
              </small>
              <p>{model.rationale}</p>
            </li>
          ))}
        </ul>
        <p className="app-muted">
          The bigger one is picked when there is memory for it. Neither is a
          replacement for the hosted models — they are good at sorting, pulling
          out facts and summarising, which is most of what runs in the
          background.
        </p>
      </details>
    </section>
  );
}
