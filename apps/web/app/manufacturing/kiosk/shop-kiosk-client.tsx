"use client";

import { useEffect, useRef, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";
import { methodLabel, stateLabel } from "../../../lib/manufacturing";
import { currentStep, partIdFromScan, partStepsPath, stepProgress, type ShopPart } from "../../../lib/manufacturing/steps-model";
import { useShopSteps } from "../use-shop-steps";

/** The kiosk forgets who's working this long after the last tap, so the next person isn't credited by mistake. */
const WORKER_RESET_MS = 90_000;

/**
 * The shop kiosk: a tablet by the machines showing every part on the floor and the step it's on,
 * with Start and Done for that step. Pick who's working first (it forgets after a minute and a
 * half). A USB barcode scanner, or typing, finds a part from its drawing's QR code.
 */
export default function ShopKioskClient() {
  const { view, problem, busy, mutate } = useShopSteps({ kiosk: true }, 20_000);
  const [workedBy, setWorkedBy] = useState("");
  const [scan, setScan] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(resetTimer.current);
    if (workedBy) resetTimer.current = window.setTimeout(() => setWorkedBy(""), WORKER_RESET_MS);
    return () => window.clearTimeout(resetTimer.current);
  }, [workedBy, busy]);

  useEffect(() => {
    if (!found) return;
    document.getElementById(`kiosk-part-${found}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setFound(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [found]);

  if (!view) {
    return (
      <main className="shop-kiosk">
        <h1>Shop</h1>
        {problem ? <p className="telemetry-status" role="alert">{problem}</p> : <p className="app-muted" role="status">Loading…</p>}
      </main>
    );
  }
  if (view.status !== "live") {
    return (
      <main className="shop-kiosk">
        <h1>Shop</h1>
        <EmptyState soft badge="Not set up yet" badgeTone="setup" title={view.reason === "no_team" ? "Choose your team" : "Shop steps are coming"} description={view.message} />
      </main>
    );
  }

  const act = (action: "start-step" | "finish-step", stepId: string) =>
    void mutate({ action, stepId, workedBy: workedBy || undefined });

  return (
    <main className="shop-kiosk">
      <header className="shop-kiosk-bar">
        <h1>Shop</h1>
        {view.canEdit && view.members.length ? (
          <label className="shop-kiosk-who">
            <span>Who's working?</span>
            <select value={workedBy} onChange={(event) => setWorkedBy(event.target.value)}>
              <option value="">Choose your name</option>
              {view.members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <form
          className="shop-kiosk-scan"
          onSubmit={(event) => {
            event.preventDefault();
            const partId = partIdFromScan(scan);
            setScan("");
            if (!partId) return;
            if (view.parts.some((part) => part.id === partId)) setFound(partId);
            else window.location.assign(partStepsPath(view.orgId, partId));
          }}
        >
          <input aria-label="Scan a drawing" placeholder="Scan a drawing" value={scan} onChange={(event) => setScan(event.target.value)} />
        </form>
      </header>
      {problem ? <p className="telemetry-status" role="alert">{problem}</p> : null}
      {view.parts.length ? (
        <ul className="shop-kiosk-grid">
          {view.parts.map((part) => (
            <KioskCard key={part.id} part={part} orgId={view.orgId} highlighted={found === part.id} canEdit={view.canEdit} busy={busy} onAct={act} />
          ))}
        </ul>
      ) : (
        <EmptyState
          soft
          title="Nothing on the floor"
          description="Parts show up here once they have steps. Open a part from the board, list its steps, and print its label for the drawing."
        >
          <Button as="a" variant="secondary" href={`/manufacturing?orgId=${encodeURIComponent(view.orgId)}`}>Open the board</Button>
        </EmptyState>
      )}
    </main>
  );
}

function KioskCard({
  part,
  orgId,
  highlighted,
  canEdit,
  busy,
  onAct,
}: {
  part: ShopPart;
  orgId: string;
  highlighted: boolean;
  canEdit: boolean;
  busy: boolean;
  onAct: (action: "start-step" | "finish-step", stepId: string) => void;
}) {
  const step = currentStep(part.steps);
  const { done, total } = stepProgress(part.steps);
  return (
    <li id={`kiosk-part-${part.id}`} className={`shop-kiosk-card${highlighted ? " is-found" : ""}${step?.status === "doing" ? " is-doing" : ""}`}>
      <a className="shop-kiosk-name" href={partStepsPath(orgId, part.id)}>
        {part.partName}
      </a>
      <small className="app-muted">
        {part.quantity} × {methodLabel(part.method)} · {stateLabel(part.state)} · {done}/{total}
      </small>
      {step ? (
        <>
          <p className="shop-kiosk-step">{step.title}</p>
          <small className="app-muted">
            {[step.machine, step.status === "doing" && step.workedByName ? `${step.workedByName} is on it` : null].filter(Boolean).join(" · ") || " "}
          </small>
          {canEdit ? (
            step.status === "doing" ? (
              <Button variant="primary" size="lg" disabled={busy} onClick={() => onAct("finish-step", step.id)}>Done</Button>
            ) : (
              <Button variant="primary" size="lg" disabled={busy} onClick={() => onAct("start-step", step.id)}>Start</Button>
            )
          ) : null}
        </>
      ) : (
        <p className="shop-kiosk-step">All steps done</p>
      )}
    </li>
  );
}
