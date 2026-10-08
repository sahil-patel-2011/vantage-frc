"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { BrowserDecision, BrowserTurnInput } from "../../../lib/cad/browser-turn";
import { browserActionProgress } from "../../../lib/cad/browser-progress";
import styles from "./browser-agent.module.css";

export type NativeCadTools = {
  tool(input: { name: "observe" | "bind" | "action"; arguments?: Record<string, unknown> }): Promise<unknown>;
  stop(): Promise<unknown>;
};
type Message = { role: "user" | "assistant"; content: string; category?: "result" };
type Drawing = { name: string; dataBase64: string };
type Observation = BrowserTurnInput["observation"];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readObservation(value: unknown): Observation {
  const row = object(value);
  const viewport = object(row?.viewport);
  if (!row || typeof row.id !== "string" || typeof row.url !== "string" || typeof row.aria !== "string" ||
    typeof row.screenshotBase64 !== "string" || !viewport || typeof viewport.width !== "number" || typeof viewport.height !== "number" || !object(row.controls)) {
    throw new Error("The browser did not return a complete view. No new CAD action was sent.");
  }
  if (!("binding" in row) || (row.binding !== null && !object(row.binding)) || !object(row.canvasBounds)) {
    throw new Error("This desktop connector does not provide current document context. Use the matching browser pilot build before starting a CAD task.");
  }
  return {
    id: row.id, url: row.url, aria: row.aria.slice(0, 50000), screenshotBase64: row.screenshotBase64,
    viewport: { width: viewport.width, height: viewport.height }, controls: row.controls as Observation["controls"],
    binding: row.binding as Observation["binding"], canvasBounds: row.canvasBounds as Observation["canvasBounds"],
  };
}

function readDecision(value: unknown): BrowserDecision {
  const row = object(value);
  if (!row || typeof row.text !== "string" || !["reply", "clarification", "action"].includes(String(row.kind))) throw new Error("The assistant did not return a usable next step.");
  if (row.kind === "action") {
    const tool = object(row.tool);
    if (!tool || !["bind", "action"].includes(String(tool.name)) || !object(tool.arguments)) throw new Error("The assistant returned an unsupported action.");
  }
  if (row.kind === "reply" && !["complete", "partial", "unsupported"].includes(String(row.outcome))) throw new Error("The assistant did not identify which work remains.");
  return value as BrowserDecision;
}

function compactEvidence(result: unknown, tool: string): string {
  const row = object(result);
  if (!row) return `${tool}: no structured outcome was returned`;
  const observation = object(row.observation);
  // Images and entire document snapshots never enter conversation history.
  return JSON.stringify({ tool, ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "observation" && key !== "screenshotBase64")),
    ...(observation ? { resultUrl: observation.url, observationId: observation.id } : {}) }).slice(0, 6000);
}

async function loadDrawing(file: File): Promise<Drawing> {
  if (file.size > 1024 * 1024) throw new Error("Choose a PNG drawing smaller than 1 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) throw new Error("Choose a PNG drawing. Other image formats are not supported in this pilot.");
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 8_388_608) throw new Error("Use a PNG no larger than 4096 pixels per side and 8 megapixels.");
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result.split(",")[1] ?? "") : reject(new Error("Could not read this drawing."));
    reader.onerror = () => reject(new Error("Could not read this drawing."));
    reader.onabort = () => reject(new Error("Drawing attachment was cancelled."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, dataBase64 };
}

export default function NativeCadChat({ orgId, bridge, ready, onRunningChange }: {
  orgId: string; bridge: NativeCadTools; ready: boolean; onRunningChange: (running: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<"clarification" | "limit" | null>(null);
  const run = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const attachVersion = useRef(0);
  const evidence = useRef<string[]>([]);
  const transcript = useRef<HTMLOListElement | null>(null);
  const followTranscript = useRef(true);
  const stopPending = useRef(false);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attachVersion.current++;
      if (run.current) { run.current.abort(); void bridge.stop().catch(() => undefined); }
    };
  }, [bridge]);
  useEffect(() => { onRunningChange(running); }, [running, onRunningChange]);
  useEffect(() => {
    if (followTranscript.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (continuation === "clarification" && !running && ready) composer.current?.focus();
  }, [continuation, running, ready]);
  useEffect(() => {
    if (!ready && run.current) {
      run.current.abort();
      setStatus("Browser stopped. Reopen Onshape and inspect the document before continuing.");
    }
  }, [ready]);

  async function attach(file?: File) {
    if (!file) return;
    const version = ++attachVersion.current;
    setAttaching(true);
    setError("");
    try {
      const next = await loadDrawing(file);
      if (mounted.current && version === attachVersion.current) setDrawing(next);
    } catch (cause) {
      if (mounted.current && version === attachVersion.current) setError(cause instanceof Error ? cause.message : "Could not attach this drawing.");
    } finally {
      if (mounted.current && version === attachVersion.current) setAttaching(false);
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (run.current || stopPending.current || !ready || attaching || !input.trim()) return;
    const userText = input.trim();
    const task = pendingTask ? `${pendingTask}\n\nUser follow-up: ${userText}` : userText;
    if (task.length > 6000) { setError("This task has reached its context limit. Start a new task with the dimensions and remaining work."); return; }
    const controller = new AbortController();
    run.current = controller;
    setRunning(true); setError(""); setStatus("Inspecting the current Onshape view…"); setInput("");
    setPendingTask(task); setContinuation(null);
    if (!pendingTask) evidence.current = [];
    const history: Message[] = [...messages, { role: "user", content: userText }].slice(-12);
    setMessages(history);
    const addReply = (text: string, category?: "result") => {
      history.push({ role: "assistant", content: text, ...(category ? { category } : {}) });
      if (mounted.current) setMessages([...history].slice(-32));
    };
    try {
      for (let step = 0; step < 12; step++) {
        if (controller.signal.aborted) break;
        setStatus(`Step ${step + 1} of 12 · Inspecting Onshape`);
        const observation = readObservation(await bridge.tool({ name: "observe", arguments: {} }));
        if (controller.signal.aborted) break;
        setStatus(`Step ${step + 1} of 12 · Planning the next action`);
        const body: BrowserTurnInput = {
          orgId, requestId: crypto.randomUUID(), consent: true, task, step,
          history: history.slice(-12).map(({ role, content }) => ({ role, content })), evidence: evidence.current.slice(-12), observation,
          ...(drawing ? { drawing: { mimeType: "image/png", dataBase64: drawing.dataBase64 } } : {}),
        };
        const response = await fetch("/api/cad/browser-agent/turn", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        });
        const answer: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) break;
        const answerObject = object(answer);
        if (!response.ok) throw new Error(typeof answerObject?.error === "string" ? answerObject.error : "The assistant could not continue. No next action was sent.");
        const decision = readDecision(answerObject?.decision);
        const answeringModel = object(answerObject?.model);
        if (typeof answeringModel?.name === "string") setModel(answeringModel.name);
        addReply(decision.text);
        if (decision.kind !== "action") {
          setContinuation(decision.kind === "clarification" ? "clarification" : null);
          // Keep dimensions and the original brief for follow-ups, including a
          // manual handoff. Only New task deliberately resets the task context.
          setPendingTask(task);
          setStatus(decision.kind === "clarification" ? "Waiting for your answer. No more actions will run."
            : decision.outcome === "complete" ? "The assistant reports the requested work is complete. Review its measurements and evidence."
              : decision.outcome === "unsupported" ? "Paused for an unsupported operation. Review the assistant's manual handoff before continuing."
                : "Work is partial or unverified. Review what remains before continuing.");
          return;
        }
        if (controller.signal.aborted) break;
        setStatus(`Step ${step + 1} of 12 · Applying one browser action`);
        const result = await bridge.tool(decision.tool);
        if (controller.signal.aborted) break;
        evidence.current = [...evidence.current, compactEvidence(result, decision.tool.name)].slice(-12);
        if (decision.tool.name === "action") {
          const progress = browserActionProgress(result, Boolean(decision.tool.arguments.postcondition));
          addReply(progress.message, "result");
          setStatus(progress.message);
          if (progress.pause) {
            setContinuation("limit");
            setStatus("Paused for review. Check the reported result in Onshape before continuing; no automatic retry will run.");
            return;
          }
        } else {
          addReply("Working document selected. Geometry checks are still pending.", "result");
        }
      }
      if (!controller.signal.aborted) {
        setContinuation("limit");
        setStatus("Paused after 12 planning steps. Review Onshape and tell the assistant what to continue. Nothing resumes automatically.");
      }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        const failure = cause instanceof Error ? cause.message : "The task stopped without a confirmed result.";
        evidence.current = [...evidence.current, JSON.stringify({ error: failure.slice(0, 3000), instruction: "The prior step was not confirmed. Inspect the current view before retrying." })].slice(-12);
        setError(failure);
        setStatus("Paused. Inspect the current document before retrying; earlier actions may have changed it.");
        setContinuation("limit");
      }
    } finally {
      if (run.current === controller) run.current = null;
      if (mounted.current) setRunning(false);
    }
  }

  async function stop() {
    if (stopPending.current) return;
    stopPending.current = true;
    setStopping(true);
    run.current?.abort();
    evidence.current = [...evidence.current, "The user stopped the task. An in-flight action may have partially completed. Inspect the current view before retrying."].slice(-12);
    setStatus("Stopping the task and closing the Onshape browser…");
    let confirmed = false;
    try { await bridge.stop(); confirmed = true; }
    catch { if (mounted.current) setError("The browser stop was not confirmed. Check the desktop window before continuing."); }
    finally {
      stopPending.current = false;
      if (mounted.current) { setStopping(false); setRunning(false); setContinuation("limit"); setStatus(confirmed ? "Task stopped. Reopen Onshape and inspect the document before continuing. A model request already sent may still finish and incur usage." : "Further planning stopped. Browser closure needs confirmation before continuing."); }
    }
  }

  if (!ready && !messages.length) return null;
  return (
    <section className={styles.chat} aria-labelledby="native-cad-title">
      <header className={styles.chatHeader}><div><h3 id="native-cad-title">Make your next move</h3><p className={styles.note}>Describe a part, refine a feature or check a measurement.</p></div>{model ? <span className={styles.modelName} title={`Answering model: ${model}`}>{model}</span> : null}</header>
      {messages.length ? <ol ref={transcript} className={styles.messages} aria-label="CAD conversation" tabIndex={0} onScroll={(event) => { const list = event.currentTarget; followTranscript.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60; }}>{messages.map((message, index) => <li key={index} data-role={message.role} data-category={message.category}><span className={styles.messageRole}>{message.role === "user" ? "You" : message.category === "result" ? "Observed result" : "Assistant"}</span><p id={continuation === "clarification" && index === messages.length - 1 ? "native-cad-question" : undefined}>{message.content}</p></li>)}</ol> : null}
      {status ? <p className={styles.taskStatus} data-active={running || stopping} role="status" aria-live="polite">{status}</p> : null}
      {error ? <div role="alert" className={styles.error}><p>{error}</p><a href={withOrgHref("/ai", orgId)}>AI settings and limits</a></div> : null}
      {drawing ? <figure className={styles.drawing}><img src={`data:image/png;base64,${drawing.dataBase64}`} alt={`Attached drawing: ${drawing.name}`} /><figcaption><span><strong>Reference drawing</strong><span className={styles.note}>{drawing.name}</span></span><Button variant="ghost" disabled={running || stopping} onClick={() => { attachVersion.current++; setAttaching(false); setDrawing(null); }}>Remove</Button></figcaption></figure> : null}
      {ready ? <form className={styles.form} onSubmit={start}>
        <label htmlFor="native-cad-message">{continuation === "clarification" ? "Your answer" : pendingTask ? "Continue this task" : "Your task"}</label>
        <textarea ref={composer} id="native-cad-message" value={input} onChange={(event) => setInput(event.target.value)} maxLength={6000} rows={4} disabled={running || stopping || !ready}
          placeholder="For example: Make a 60 mm × 40 mm plate, 5 mm thick, on the Top plane." aria-describedby={continuation === "clarification" ? "native-cad-question native-cad-disclosure" : "native-cad-disclosure"} />
        <div className={styles.attachment}>
          <input ref={attachmentInput} type="file" hidden accept="image/png,.png" disabled={running || stopping || attaching} aria-label="Reference drawing" onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }} />
          <Button variant="ghost" disabled={running || stopping || attaching} onClick={() => attachmentInput.current?.click()}>{attaching ? "Reading drawing…" : drawing ? "Replace drawing" : "Attach drawing"}</Button>
          <span className={styles.note}>Optional · PNG, up to 1 MiB</span>
        </div>
        <p id="native-cad-disclosure" className={styles.note}>Your task, Onshape view and drawing are sent to your configured remote AI model. Team AI limits apply to every planning step.</p>
        <details className={styles.details}><summary>Usage and privacy</summary><p className={styles.note}>Up to 12 steps run per submission. Stop prevents further actions; an already-sent model request may still finish and incur usage. Screenshots and drawings are not saved in conversation history.</p></details>
        <div className={styles.chatActions}>
          {running || stopping ? <Button variant="secondary" onClick={() => void stop()} disabled={stopping}>{stopping ? "Stopping…" : "Stop task"}</Button> : <Button type="submit" variant="primary" disabled={!ready || !input.trim() || attaching}>{attaching ? "Reading drawing…" : pendingTask ? "Continue task" : "Start task"}</Button>}
          {(pendingTask || messages.length > 0) && !running && !stopping ? <Button variant="ghost" onClick={() => { attachVersion.current++; setAttaching(false); setModel(""); setPendingTask(null); setContinuation(null); evidence.current = []; setMessages([]); setDrawing(null); setInput(""); setError(""); setStatus(""); composer.current?.focus(); }}>New task</Button> : null}
        </div>
      </form> : !stopping ? <p className={styles.note}>Open Onshape above to continue this task.</p> : null}
    </section>
  );
}
