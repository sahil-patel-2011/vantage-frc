"use client";
import { useEffect, useState } from "react";

type Thread = { id: string; title: string; scope: "private" | "team" };
type Message = { id: string; role: string; content: string; explicitlyShared: boolean; provider?: string; model?: string };
type Memory = { id: string; kind: string; content: string; disabledAt: string | null };

export default function ChatClient({ orgId }: { orgId: string }) {
  const [threads, setThreads] = useState<Thread[]>([]); const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]); const [memories, setMemories] = useState<Memory[]>([]);
  const [text, setText] = useState("");
  const [memory, setMemory] = useState(""); const [status, setStatus] = useState("");
  async function load(threadId?: string) {
    const response = await fetch(`/api/agent?orgId=${orgId}${threadId ? `&threadId=${threadId}` : ""}`);
    const data = await response.json(); setThreads(data.threads ?? []); setMemories(data.memories ?? []);
    if (threadId) setMessages(data.messages ?? []);
  }
  useEffect(() => { void load(); }, [orgId]);
  async function newThread(nextScope: "private"|"team") {
    const response = await fetch("/api/agent", { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"thread",orgId,scope:nextScope,title:nextScope === "team" ? "Team strategy channel" : "Private workspace"}) });
    const data = await response.json(); if (!response.ok) return setStatus(data.error);
    const value = { id:data.threadId,title:nextScope === "team" ? "Team strategy channel" : "Private workspace",scope:nextScope };
    setThread(value); setMessages([]); await load();
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (!thread || !text.trim()) return;
    setStatus("Thinking with bounded context…");
    const response = await fetch("/api/agent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"message",orgId,threadId:thread.id,scope:thread.scope,message:text})});
    const data = await response.json(); setStatus(response.ok ? `Used ${data.contextSources?.length ?? 0} memory sources.` : data.error);
    if (response.ok) { setText(""); await load(thread.id); }
  }
  async function saveMemory(event: React.FormEvent) {
    event.preventDefault(); const response = await fetch("/api/agent/memory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"save",orgId,kind:"preference",content:memory})});
    if (response.ok) { setMemory(""); await load(thread?.id); }
  }
  async function removeMemory(id: string) {
    if (!confirm("Delete this private memory? This cannot be undone.")) return;
    await fetch(`/api/agent/memory?id=${id}`,{method:"DELETE"}); await load(thread?.id);
  }
  return <main className="chat-page">
    <header className="workspace-top"><a className="brand" href={`/workspace?orgId=${orgId}`}>VANTAGE</a><strong>AGENT CONTEXT</strong><span>{thread?.scope === "team" ? "TEAM SHARED" : "PRIVATE"}</span></header>
    <aside className="chat-sidebar"><span className="eyebrow">CHANNELS</span><button onClick={() => newThread("private")}>+ Private chat</button><button onClick={() => newThread("team")}>+ Team-shared chat</button>
      {threads.map((item) => <button className={thread?.id === item.id ? "active" : ""} key={item.id} onClick={() => { setThread(item);void load(item.id); }}><span>{item.scope === "team" ? "SHARED" : "PRIVATE"}</span>{item.title}</button>)}
    </aside>
    <section className="chat-main">
      {!thread ? <div className="empty-chat"><h1>Choose a context boundary.</h1><p>Private chat memory belongs only to you. Team-shared channels are visible to team members and may contribute to team memory when enabled.</p></div> : <>
        <header><div><span className="eyebrow">{thread.scope === "team" ? "TEAM SHARED CHANNEL" : "PRIVATE CHANNEL"}</span><h1>{thread.title}</h1></div>{thread.scope === "team" && <strong className="shared-warning">EVERY MESSAGE IN THIS CHANNEL IS SHARED</strong>}</header>
        <div className="messages">{messages.map((item) => <article className={item.role} key={item.id}><span>{item.role}{item.explicitlyShared ? " · shared" : " · private"}</span><p>{item.content}</p>{item.model && <small>{item.provider} / {item.model}</small>}</article>)}</div>
        <form className="chat-composer" onSubmit={send}>{thread.scope === "team" && <div>TEAM SHARED · visible to members before send</div>}<textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Vantage…" /><button>Send</button></form>
        {status && <p className="chat-status" role="status">{status}</p>}
      </>}
    </section>
    <aside className="memory-panel"><span className="eyebrow">YOUR PRIVATE MEMORY</span><p>Inspect, edit, or delete what agents may recall. Nothing here enters team memory automatically.</p>
      <form onSubmit={saveMemory}><textarea value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="Add a durable preference or fact" /><button>Save private memory</button></form>
      {memories.map((item) => <article key={item.id}><small>{item.kind}</small><p>{item.content}</p><button onClick={() => removeMemory(item.id)}>Delete</button></article>)}
      <button className="memory-toggle" onClick={() => fetch("/api/agent/memory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"toggle-private",orgId,enabled:false})}).then(() => setStatus("Private memory injection disabled."))}>Disable private memory injection</button>
    </aside>
  </main>;
}
