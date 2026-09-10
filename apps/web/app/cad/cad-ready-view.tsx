"use client";

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { Button } from "../../components/ui";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { completeDocumentRef, type ListedOnshapeEntities } from "../../lib/cad/list-entities";
import type { ListedOnshapeAssembly } from "../../lib/cad/list-assembly";
import type { ListedDocumentElements } from "../../lib/cad/list-document-elements";
import type { ListedOnshapeVariables } from "../../lib/cad/list-variables";
import type { ExplainedFeature, DeleteFeaturePayload, UpdateFeaturePayload } from "../../lib/cad/feature-tree";
import { CadPurchaseRequestPanel } from "./cad-purchase-request";
import { CadFeatureTree } from "./cad-feature-tree";
import { CadOperationComposer } from "./cad-operation-composer";
import { CadCheckpointNote } from "./cad-checkpoint-note";
import { CadVariableTable } from "./cad-variable-table";
import { CadViewport } from "./cad-viewport";
import { CadActivityPanel } from "./cad-activity-panel";
import { CadStepPane } from "./cad-step-pane";
import { CadToolsPanel, type CadToolRow } from "./cad-tools-panel";
import { realReturnedId } from "./cad-session";
import {
  MODE_LABELS,
  TASK_STATUS_LABELS,
  type AgentMode,
  type AgentPlan,
  type AgentState,
  type AgentTask,
  type CadBusy,
  type CadLoadFailure,
  type PlanStep,
} from "./cad-model";

export type CadReadyViewProps = {
  orgId: string;
  tools: CadToolRow[];
  cutoffCode: string | null;
  url: string;
  setUrl: (value: string) => void;
  bind: () => Promise<void>;
  busy: CadBusy;
  listedElements: ListedDocumentElements;
  workingTabId: string;
  boundElementId: string | undefined;
  switchBoundElement: (elementId: string) => Promise<void>;
  state: AgentState | null;
  boundOk: boolean;
  onshapeOk: boolean;
  loadFailure: CadLoadFailure | null;
  error: string;
  setLoadFailure: Dispatch<SetStateAction<CadLoadFailure | null>>;
  runLoad: () => Promise<unknown>;
  mode: AgentMode;
  setModeManual: (next: AgentMode) => Promise<void>;
  connectionsHref: string;
  logRef: RefObject<HTMLDivElement | null>;
  pendingProposal: {
    mode: AgentMode;
    reasons: string[];
    expiresAt: string;
    message: string;
  } | null;
  countdown: number;
  respondProposal: (accept: boolean) => Promise<void>;
  plan: AgentPlan | null;
  planSteps: PlanStep[];
  setPlanSteps: Dispatch<SetStateAction<PlanStep[]>>;
  planAnswers: string[];
  setPlanAnswers: Dispatch<SetStateAction<string[]>>;
  approvePlan: () => Promise<void>;
  tasks: AgentTask[] | null;
  prompt: string;
  setPrompt: (value: string) => void;
  send: () => Promise<void>;
  composerHint: string;
  geometryError: string;
  refreshBoundGeometry: () => Promise<void>;
  lastCheckpointId: string | null;
  listedEntities: ListedOnshapeEntities;
  explainedFeatures: ExplainedFeature[];
  listedAssembly: ListedOnshapeAssembly;
  listedVariables: ListedOnshapeVariables;
  lastVariableStudioElementId: MutableRefObject<string | undefined>;
  onAppendComposer: (payload: Record<string, unknown>) => Promise<unknown>;
  onRunComposerPlan: (ops: unknown) => Promise<{ ok?: boolean; error?: string } | void>;
  onDeleteFeature: (payload: DeleteFeaturePayload) => Promise<unknown>;
  onUpdateFeature: (payload: UpdateFeaturePayload) => Promise<unknown>;
  onSetVariable: (payload: {
    name: string;
    expression: string;
    variableStudioElementId?: string;
  }) => Promise<unknown>;
};

export function CadReadyView({
  orgId,
  tools,
  cutoffCode,
  url,
  setUrl,
  bind,
  busy,
  listedElements,
  workingTabId,
  boundElementId,
  switchBoundElement,
  state,
  boundOk,
  onshapeOk,
  loadFailure,
  error,
  setLoadFailure,
  runLoad,
  mode,
  setModeManual,
  connectionsHref,
  logRef,
  pendingProposal,
  countdown,
  respondProposal,
  plan,
  planSteps,
  setPlanSteps,
  planAnswers,
  setPlanAnswers,
  approvePlan,
  tasks,
  prompt,
  setPrompt,
  send,
  composerHint,
  geometryError,
  refreshBoundGeometry,
  lastCheckpointId,
  listedEntities,
  explainedFeatures,
  listedAssembly,
  listedVariables,
  lastVariableStudioElementId,
  onAppendComposer,
  onRunComposerPlan,
  onDeleteFeature,
  onUpdateFeature,
  onSetVariable,
}: CadReadyViewProps) {
  return (
    <main className="module-page cad-module cad-agent">
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <header className="cad-agent-bar">
        <div className="cad-agent-brand">CAD</div>
        <label className="cad-agent-doc">
          <span>Onshape document URL</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://cad.onshape.com/documents/…"
            onKeyDown={(event) => {
              if (event.key === "Enter") void bind();
            }}
          />
        </label>
        <Button variant="primary" type="button" disabled={!url.trim() || busy !== null} onClick={() => void bind()}>
          {busy === "bind" ? "Binding…" : "Bind"}
        </Button>
        {listedElements.elements.length ? (
          <label className="cad-agent-doc">
            <span>Onshape tab</span>
            <select
              value={
                listedElements.elements.some((element) => element.id === workingTabId)
                  ? workingTabId
                  : listedElements.elements.some((element) => element.id === boundElementId)
                    ? (boundElementId ?? "")
                    : ""
              }
              disabled={busy !== null}
              onChange={(event) => {
                const next = realReturnedId(event.target.value);
                if (next) void switchBoundElement(next);
              }}
            >
              {!listedElements.elements.some(
                (element) => element.id === workingTabId || element.id === boundElementId,
              ) ? (
                <option value="">Select a listed tab</option>
              ) : null}
              {listedElements.elements.map((element) => (
                <option key={element.id} value={element.id}>
                  {element.name || element.id} ({element.elementType || element.type})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="cad-agent-leds">
          <span className={state?.onshapeConnected ? "on" : ""}>
            {state?.onshapeConnected ? "Onshape connected" : "Onshape off"}
          </span>
          {/* Name the bound document, not just "bound" — the first thing to check
              before an agent edits geometry is that it is the right Part Studio. */}
          <span className={boundOk ? "on" : ""} title={state?.bound?.documentId ?? undefined}>
            {boundOk ? state?.bound?.documentName || "Part Studio bound" : "Not bound"}
          </span>
          {state?.openUrl ? (
            <a className="cad-agent-open" href={state.openUrl} target="_blank" rel="noreferrer">
              Open in Onshape
            </a>
          ) : null}
        </div>
      </header>

      {!state && loadFailure ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: loadFailure.status,
              message: loadFailure.message,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadFailure.message,
            },
          );
          return (
            <p className="cad-agent-error" role="alert">
              <strong>{copy.title}</strong> {copy.description}{" "}
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setLoadFailure(null);
                    void runLoad();
                  }}
                >
                  Retry
                </Button>
              ) : null}
            </p>
          );
        })()
      ) : error ? (
        <p className="cad-agent-error">{error}</p>
      ) : null}

      <div className="cad-agent-workspace">
        <aside className="cad-agent-chat">
          <div className="cad-agent-col-head">
            Agent
            <div className="cad-mode-switch" role="group" aria-label="Agent mode">
              {(["simple", "plan", "multitask"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`cad-mode-btn${mode === option ? " active" : ""}`}
                  aria-pressed={mode === option}
                  disabled={busy !== null}
                  onClick={() => void setModeManual(option)}
                >
                  {MODE_LABELS[option]}
                </button>
              ))}
            </div>
          </div>
          {state && !state.onshapeConnected ? (
            <div className="cad-agent-setup">
              <p>Connect Onshape, bind a disposable Part Studio, then specify the part in millimetres.</p>
              <Button as="a" variant="primary" href={connectionsHref}>
                Connect Onshape
              </Button>
              {!state?.onshapeConfigured ? (
                <p className="cad-agent-hint">
                  Connect Onshape is not set up on this deployment. Until then paste a document link or upload a STEP/STL.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="cad-agent-log" ref={logRef}>
            {!state?.messages.length ? (
              <div className="cad-agent-hero">
                Specify the part or assembly in millimetres. Bind an Onshape Part Studio, then send a brief. The agent
                creates native sketches, extrudes, instances, and mates that remain editable in Onshape.
                {mode === "plan"
                  ? " Plan mode: the agent writes a numbered build plan and asks its questions before touching Onshape."
                  : mode === "multitask"
                    ? " Multitask mode: the brief is split into a checklist of sub-tasks worked one at a time."
                    : ""}
              </div>
            ) : (
              state.messages.map((item, index) => (
                <article key={`${item.role}-${index}`} className={`cad-agent-msg cad-agent-msg--${item.role}`}>
                  <b>{item.role === "user" ? "You" : item.role === "tool" ? "Tool" : "Agent"}</b>
                  <p>{item.text}</p>
                </article>
              ))
            )}

            {pendingProposal ? (
              <div className="cad-proposal-card" role="alert">
                <b>Switch to {MODE_LABELS[pendingProposal.mode]} mode?</b>
                <p>
                  {pendingProposal.reasons.length
                    ? pendingProposal.reasons.join(" ")
                    : "The agent thinks another mode fits this brief better."}
                </p>
                <p className="cad-proposal-count" aria-live="polite">
                  Continuing in {MODE_LABELS[mode]} mode in {countdown}s unless you choose.
                </p>
                <div className="cad-proposal-actions">
                  <Button variant="primary" type="button" disabled={busy !== null} onClick={() => void respondProposal(true)}>
                    Yes, switch
                  </Button>
                  <Button variant="secondary" type="button" disabled={busy !== null} onClick={() => void respondProposal(false)}>
                    No, stay in {MODE_LABELS[mode]}
                  </Button>
                </div>
              </div>
            ) : null}

            {mode === "plan" && plan ? (
              <div className="cad-plan-panel">
                <b>Build plan — review before anything runs in Onshape</b>
                <ol className="cad-plan-steps">
                  {planSteps.map((step, index) => (
                    <li key={`plan-step-${index}`}>
                      <input
                        value={step.title}
                        aria-label={`Step ${index + 1}`}
                        onChange={(event) =>
                          setPlanSteps((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)),
                          )
                        }
                      />
                      {step.detail ? <span className="cad-plan-detail">{step.detail}</span> : null}
                    </li>
                  ))}
                </ol>
                {plan.questions.length ? (
                  <div className="cad-plan-questions">
                    <b>Questions from the agent</b>
                    {plan.questions.map((question, index) => (
                      <label key={`plan-q-${index}`}>
                        <span>{question}</span>
                        <input
                          value={planAnswers[index] ?? ""}
                          placeholder="Answer in mm where relevant"
                          onChange={(event) =>
                            setPlanAnswers((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))
                          }
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="cad-plan-actions">
                  <Button variant="primary" type="button" disabled={busy !== null} onClick={() => void approvePlan()}>
                    Approve &amp; build
                  </Button>
                  <span className="cad-agent-hint">Or send a message below to revise the plan.</span>
                </div>
              </div>
            ) : null}

            {tasks?.length ? (
              <div className="cad-task-list">
                <b>Sub-task checklist</b>
                <ul>
                  {tasks.map((task) => (
                    <li key={task.id} className={`cad-task cad-task--${task.status}`}>
                      <span className="cad-task-status">{TASK_STATUS_LABELS[task.status]}</span>
                      <span className="cad-task-title">{task.title}</span>
                      {task.note ? <span className="cad-task-note">{task.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="cad-agent-hint">
                  Sub-tasks run one at a time through a single Onshape session — multitask is decomposition and progress
                  tracking, not parallel writes.
                </p>
              </div>
            ) : null}

            <CadStepPane steps={state?.steps ?? []} />

            {busy === "chat" ? <p className="cad-agent-hint">Working in Onshape…</p> : null}
          </div>
          <div className="cad-agent-composer">
            <textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. build an 80×50×6 mm plate, or mate these two parts with a revolute joint."
              disabled={pendingProposal !== null}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="cad-agent-composer-bar">
              <span>{pendingProposal ? "Answer the mode question above first" : composerHint}</span>
              <Button
                variant="primary"
                type="button"
                disabled={!prompt.trim() || busy !== null || pendingProposal !== null}
                onClick={() => void send()}
              >
                {busy === "chat" ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </aside>

        <CadViewport
          pngBase64={state?.shadedPngBase64}
          openUrl={state?.openUrl}
          setupRequired={!onshapeOk}
        />
      </div>

      {geometryError ? (
        <p className="app-muted" role="alert">
          {geometryError}
        </p>
      ) : null}
      <Button variant="primary" type="button" onClick={() => void refreshBoundGeometry()}>
        Refresh geometry
      </Button>
      <CadCheckpointNote checkpointId={lastCheckpointId} />
      <CadOperationComposer
        platform="onshape"
        disabled={!onshapeOk || !boundOk || busy !== null}
        entities={listedEntities}
        features={explainedFeatures}
        instances={listedAssembly.instances}
        onAppend={onAppendComposer}
        onRunPlan={onRunComposerPlan}
      />

      {completeDocumentRef(state?.bound) ? (
        <CadFeatureTree
          features={explainedFeatures}
          disabled={!onshapeOk || !boundOk || busy !== null}
          onDelete={onDeleteFeature}
          onUpdate={onUpdateFeature}
        />
      ) : null}

      {completeDocumentRef(state?.bound) ? (
        <CadVariableTable
          variables={listedVariables.variables}
          variableStudioElementId={
            lastVariableStudioElementId.current || listedVariables.variableStudioElementId
          }
          disabled={!onshapeOk || !boundOk || busy !== null}
          onSet={onSetVariable}
        />
      ) : null}

      <CadToolsPanel tools={tools} />

      {boundOk ? (
        <CadPurchaseRequestPanel
          orgId={orgId}
          defaultTitle={`${state?.bound?.documentName || "CAD build"} parts`}
          defaultWhy={`Needed to manufacture or assemble the ${state?.bound?.documentName || "bound CAD"} design.`}
        />
      ) : null}

      <CadActivityPanel orgId={orgId} />
    </main>
  );
}
