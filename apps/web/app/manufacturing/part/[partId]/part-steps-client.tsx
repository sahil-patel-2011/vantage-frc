"use client";

import { useEffect, useState } from "react";
import { ActionMenu, Badge, Button, EmptyState, PageHeader, Panel } from "../../../../components/ui";
import { methodLabel, stateLabel } from "../../../../lib/manufacturing";
import {
  currentStep,
  partStepsPath,
  stepProgress,
  stepTemplate,
  type ShopPart,
  type ShopStep,
} from "../../../../lib/manufacturing/steps-model";
import { renderQrDataUrl } from "../../../../lib/scouting/qr-camera";
import { useShopSteps } from "../../use-shop-steps";

/**
 * Where a part's QR code lands (printed on its drawing): the steps to make it, in order, with the
 * drawing one tap away. The next step has the one big button; editing the list is behind a toggle.
 */
export default function PartStepsClient({ partId }: { partId: string }) {
  const { view, problem, busy, mutate } = useShopSteps({ partId });

  if (!view) {
    return (
      <main className="module-page shop-page">
        <PageHeader title="Part steps" />
        {problem ? <p className="telemetry-status" role="alert">{problem}</p> : <p className="app-muted" role="status">Loading…</p>}
      </main>
    );
  }
  if (view.status !== "live") {
    return (
      <main className="module-page shop-page">
        <PageHeader title="Part steps" />
        <EmptyState soft badge="Not set up yet" badgeTone="setup" title={view.reason === "no_team" ? "Choose your team" : "Shop steps are coming"} description={view.message}>
          <Button as="a" variant="secondary" href={view.reason === "no_team" ? "/workspace" : "/manufacturing"}>
            {view.reason === "no_team" ? "Choose your team" : "Back to the board"}
          </Button>
        </EmptyState>
      </main>
    );
  }
  const part = view.parts[0];
  if (!part) {
    return (
      <main className="module-page shop-page">
        <PageHeader title="Part steps" />
        <EmptyState soft title="This part isn't on your board" description="It may have been deleted, or the code belongs to another team." >
          <Button as="a" variant="secondary" href={`/manufacturing?orgId=${encodeURIComponent(view.orgId)}`}>Open the board</Button>
        </EmptyState>
      </main>
    );
  }
  return <PartSteps part={part} orgId={view.orgId} canEdit={view.canEdit} busy={busy} problem={problem} mutate={mutate} />;
}

function PartSteps({
  part,
  orgId,
  canEdit,
  busy,
  problem,
  mutate,
}: {
  part: ShopPart;
  orgId: string;
  canEdit: boolean;
  busy: boolean;
  problem: string | null;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const next = currentStep(part.steps);
  const { done, total } = stepProgress(part.steps);
  const template = stepTemplate(part.method);

  return (
    <main className="module-page shop-page">
      <PageHeader
        title={part.partName}
        description={[`${part.quantity} × ${methodLabel(part.method)}`, part.material, part.subsystemName, part.neededBy ? `Needed by ${part.neededBy}` : null].filter(Boolean).join(" · ")}
      />
      <div className="shop-part-meta">
        <Badge tone={part.state === "done" ? "good" : "neutral"}>{stateLabel(part.state)}</Badge>
        {total ? <span className="app-muted">{done} of {total} steps done</span> : null}
        <a className="shop-back" href={`/manufacturing?orgId=${encodeURIComponent(orgId)}`}>Board</a>
      </div>
      {problem ? <p className="telemetry-status" role="alert">{problem}</p> : null}

      <DrawingRow part={part} canEdit={canEdit} busy={busy} mutate={mutate} />

      <Panel className="shop-panel" aria-label="Steps">
        {part.steps.length ? (
          <ol className="shop-steps">
            {part.steps.map((step, index) => (
              <StepItem
                key={step.id}
                step={step}
                isNext={next?.id === step.id}
                first={index === 0}
                last={index === part.steps.length - 1}
                editing={editing}
                canEdit={canEdit}
                busy={busy}
                mutate={mutate}
              />
            ))}
          </ol>
        ) : (
          <div className="shop-empty">
            <p>No steps yet. List what this part goes through on the floor, in order.</p>
            {canEdit && template.length ? (
              <Button variant="primary" disabled={busy} onClick={() => void mutate({ action: "use-template", partId: part.id })}>
                Start with {methodLabel(part.method).toLowerCase()} steps
              </Button>
            ) : null}
          </div>
        )}
        {canEdit && (editing || !part.steps.length) ? <AddStep partId={part.id} busy={busy} mutate={mutate} /> : null}
        {canEdit && part.steps.length ? (
          <div className="shop-edit-toggle">
            <Button variant="ghost" size="sm" onClick={() => setEditing((value) => !value)}>
              {editing ? "Done editing" : "Edit steps"}
            </Button>
          </div>
        ) : null}
      </Panel>

      <PartLabel part={part} orgId={orgId} />
    </main>
  );
}

function StepItem({
  step,
  isNext,
  first,
  last,
  editing,
  canEdit,
  busy,
  mutate,
}: {
  step: ShopStep;
  isNext: boolean;
  first: boolean;
  last: boolean;
  editing: boolean;
  canEdit: boolean;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(step.title);
  const [machine, setMachine] = useState(step.machine ?? "");
  useEffect(() => {
    setTitle(step.title);
    setMachine(step.machine ?? "");
  }, [step.title, step.machine]);

  return (
    <li className={`shop-step is-${step.status}${isNext ? " is-next" : ""}`}>
      <span className="shop-step-mark" aria-hidden="true">{step.status === "done" ? "✓" : step.position + 1}</span>
      <div className="shop-step-body">
        {editing ? (
          <form
            className="shop-step-edit"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({ action: "edit-step", stepId: step.id, title, machine, notes: step.notes });
            }}
          >
            <input aria-label="Step" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
            <input aria-label="Machine" placeholder="Machine" value={machine} maxLength={60} onChange={(event) => setMachine(event.target.value)} />
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !title.trim() || (title === step.title && machine === (step.machine ?? ""))}>Save</Button>
          </form>
        ) : (
          <>
            <strong>{step.title}</strong>
            <small className="app-muted">
              {[step.machine, step.status === "doing" && step.workedByName ? `${step.workedByName} is on it` : null, step.status === "done" && step.workedByName ? `Done by ${step.workedByName}` : null].filter(Boolean).join(" · ")}
            </small>
            {step.notes ? <p className="shop-step-notes">{step.notes}</p> : null}
          </>
        )}
      </div>
      {canEdit ? (
        <div className="shop-step-actions">
          {editing ? (
            <ActionMenu
              overflowOnly
              tone="row"
              label={`${step.title} step`}
              triggerTestId={`shop-step-more:${step.id}`}
              actions={[
                { id: "up", label: "Move up", disabled: busy || first, onClick: () => void mutate({ action: "move-step", stepId: step.id, direction: "up" }) },
                { id: "down", label: "Move down", disabled: busy || last, onClick: () => void mutate({ action: "move-step", stepId: step.id, direction: "down" }) },
                { id: "delete", label: "Delete step", intent: "destructive", disabled: busy, onClick: () => void mutate({ action: "delete-step", stepId: step.id }) },
              ]}
            />
          ) : step.status === "done" ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ action: "reopen-step", stepId: step.id })}>Undo</Button>
          ) : step.status === "doing" ? (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void mutate({ action: "finish-step", stepId: step.id })}>Done</Button>
          ) : isNext ? (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void mutate({ action: "start-step", stepId: step.id })}>Start</Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AddStep({ partId, busy, mutate }: { partId: string; busy: boolean; mutate: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [machine, setMachine] = useState("");
  return (
    <form
      className="shop-add"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await mutate({ action: "add-step", partId, title, machine })) {
          setTitle("");
          setMachine("");
        }
      }}
    >
      <input aria-label="New step" placeholder="Add a step, like “Mill pockets”" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      <input aria-label="Machine for the new step" placeholder="Machine" value={machine} maxLength={60} onChange={(event) => setMachine(event.target.value)} />
      <Button type="submit" variant="secondary" disabled={busy || !title.trim()}>Add step</Button>
    </form>
  );
}

function DrawingRow({ part, canEdit, busy, mutate }: { part: ShopPart; canEdit: boolean; busy: boolean; mutate: (payload: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(part.drawingUrl ?? "");
  if (editing) {
    return (
      <form
        className="shop-drawing"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await mutate({ action: "set-drawing", partId: part.id, drawingUrl: url })) setEditing(false);
        }}
      >
        <input type="url" aria-label="Drawing link" placeholder="https://cad.onshape.com/… or a PDF link" value={url} onChange={(event) => setUrl(event.target.value)} />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }
  return (
    <div className="shop-drawing">
      {part.drawingUrl ? (
        <Button as="a" variant="secondary" href={part.drawingUrl} target="_blank" rel="noreferrer">Open drawing</Button>
      ) : (
        <span className="app-muted">No drawing linked.</span>
      )}
      {canEdit ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>{part.drawingUrl ? "Change link" : "Link a drawing"}</Button>
      ) : null}
    </div>
  );
}

/** The QR label to print and tape onto the part's drawing. Only the label prints. */
function PartLabel({ part, orgId }: { part: ShopPart; orgId: string }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void renderQrDataUrl(new URL(partStepsPath(orgId, part.id), window.location.origin).href, 360).then((url) => {
      if (live) setQr(url);
    });
    return () => {
      live = false;
    };
  }, [orgId, part.id]);
  return (
    <section className="shop-label-wrap" aria-label="Drawing label">
      <div className="shop-label">
        {qr ? <img src={qr} alt={`QR code for ${part.partName}`} width={180} height={180} /> : <div className="shop-label-qr-placeholder" />}
        <div>
          <strong>{part.partName}</strong>
          <span>{part.quantity} × {methodLabel(part.method)}{part.material ? ` · ${part.material}` : ""}</span>
          <span className="app-muted">Scan for the steps</span>
        </div>
      </div>
      <Button variant="secondary" onClick={() => window.print()} disabled={!qr}>Print label for the drawing</Button>
    </section>
  );
}
