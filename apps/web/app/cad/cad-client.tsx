"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./cad-agent.css";
import "./cad-setup.css";

type BoundDoc = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  documentName?: string | null;
  url?: string | null;
};

type ChatMessage = { role: "user" | "assistant" | "tool"; text: string };

type AgentState = {
  onshapeConfigured: boolean;
  onshapeConnected: boolean;
  bound: BoundDoc | null;
  iframeUrl: string | null;
  openUrl: string | null;
  messages: ChatMessage[];
};

export default function CadWorkspace({ orgId, embedded: _embedded = false }: { orgId: string; embedded?: boolean }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<AgentState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"load" | "bind" | "chat" | null>("load");
  const [error, setError] = useState("");
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/cad/agent?orgId=${encodeURIComponent(orgId)}`);
    const data = (await response.json()) as AgentState & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load CAD agent");
    setState(data);
    if (data.bound?.url) setUrl(data.bound.url);
    return data;
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    void load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load CAD agent");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state?.messages, busy]);

  async function bind() {
    setBusy("bind");
    setError("");
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bind", orgId, url }),
      });
      const data = (await response.json()) as { error?: string; bound?: BoundDoc; iframeUrl?: string; openUrl?: string };
      if (!response.ok) throw new Error(data.error ?? "Bind failed");
      setState((prev) =>
        prev
          ? {
              ...prev,
              bound: data.bound ?? prev.bound,
              iframeUrl: data.iframeUrl ?? prev.iframeUrl,
              openUrl: data.openUrl ?? prev.openUrl,
            }
          : prev,
      );
      if (data.bound?.url) setUrl(data.bound.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bind failed");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const message = prompt.trim();
    if (!message) return;
    setBusy("chat");
    setError("");
    setCutoffCode(null);
    setPrompt("");
    setState((prev) =>
      prev ? { ...prev, messages: [...prev.messages, { role: "user", text: message }] } : prev,
    );
    try {
      const response = await fetch("/api/cad/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "chat", orgId, message }),
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        text?: string;
        messages?: ChatMessage[];
      };
      if (!response.ok) {
        setCutoffCode(resolveCutoffErrorCode(response.status, data));
        throw new Error(data.error ?? "CAD agent failed");
      }
      if (data.messages) {
        setState((prev) => (prev ? { ...prev, messages: data.messages ?? prev.messages } : prev));
      }
      await load().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD agent failed");
    } finally {
      setBusy(null);
    }
  }

  const onshapeOk = Boolean(state?.onshapeConnected || state?.onshapeConfigured);
  const boundOk = Boolean(state?.bound?.documentId);
  const connectionsHref = withOrgHref("/cad/connections", orgId);
  const iframeUrl = state?.iframeUrl || state?.openUrl || "";

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
        <button className="app-button" type="button" disabled={!url.trim() || busy !== null} onClick={() => void bind()}>
          {busy === "bind" ? "Binding…" : "Bind"}
        </button>
        <div className="cad-agent-leds">
          <span className={state?.onshapeConnected ? "on" : ""}>
            {state?.onshapeConnected ? "Onshape connected" : "Onshape off"}
          </span>
          <span className={boundOk ? "on" : ""}>{boundOk ? "Part Studio bound" : "Not bound"}</span>
        </div>
      </header>

      {error ? <p className="cad-agent-error">{error}</p> : null}

      <div className="cad-agent-workspace">
        <aside className="cad-agent-chat">
          <div className="cad-agent-col-head">Agent</div>
          {state && !state.onshapeConnected ? (
            <div className="cad-agent-setup">
              <p>Connect Onshape, bind a disposable Part Studio, then specify the part in millimetres.</p>
              <a className="app-button" href={connectionsHref}>
                Connect Onshape
              </a>
              {!state?.onshapeConfigured ? (
                <p className="cad-agent-hint">
                  Server setup still required for OAuth. Until then this page will not invent geometry.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="cad-agent-log" ref={logRef}>
            {!state?.messages.length ? (
              <div className="cad-agent-hero">
                Specify the part in millimetres. Bind the Onshape Part Studio, then send a brief. The agent sketches and
                extrudes live — this is not a mock job.
              </div>
            ) : (
              state.messages.map((item, index) => (
                <article key={`${item.role}-${index}`} className={`cad-agent-msg cad-agent-msg--${item.role}`}>
                  <b>{item.role === "user" ? "You" : item.role === "tool" ? "Tool" : "Agent"}</b>
                  <p>{item.text}</p>
                </article>
              ))
            )}
            {busy === "chat" ? <p className="cad-agent-hint">Working in Onshape…</p> : null}
          </div>
          <div className="cad-agent-composer">
            <textarea
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. 80×50×6 mm plate, sketch on Top, extrude 6 mm."
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="cad-agent-composer-bar">
              <span>{onshapeOk ? "Ctrl+Enter to send" : "Connect Onshape first"}</span>
              <button
                className="app-button"
                type="button"
                disabled={!prompt.trim() || busy !== null}
                onClick={() => void send()}
              >
                {busy === "chat" ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </aside>

        <section className="cad-agent-viewport">
          <div className="cad-agent-col-head">
            Viewport
            {state?.openUrl ? (
              <a href={state.openUrl} target="_blank" rel="noreferrer">
                Open in Onshape
              </a>
            ) : (
              <span>Onshape</span>
            )}
          </div>
          {iframeUrl ? (
            <iframe title="Onshape" src={iframeUrl} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" />
          ) : (
            <div className="cad-agent-empty-view">
              No Part Studio yet. Paste an Onshape document URL and Bind — Onshape may block embedding; use Open in
              Onshape if the frame stays blank.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
