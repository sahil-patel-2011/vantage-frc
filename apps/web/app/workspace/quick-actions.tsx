"use client";
import { useEffect } from "react";
export default function QuickActions({ orgId }: { orgId: string }) {
  const actions: Array<[string, string, string, string]> = [
    ["S","SCOUT NOW","Open offline form",`/scouting?orgId=${orgId}`],
    ["I","TEAM INTEL","Lookup or compare",`/intel?orgId=${orgId}`],
    ["A","VANTAGE AGENT","Plan with context",`/chat?orgId=${orgId}`],
    ["C","AI CAD BUILDER","Strategy to verified geometry",`/cad?orgId=${orgId}`],
  ];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const action = actions.find(([key]) => key.toLowerCase() === event.key.toLowerCase());
      if (action) window.location.assign(action[3]);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });
  return <section className="quick-actions" aria-label="Competition quick actions">
    {actions.map(([key,title,copy,href], index) => <a className={`quick ${index === 0 ? "primary" : ""}`} href={href} key={key}><span>{title}</span><strong>{copy}</strong><kbd>{key}</kbd></a>)}
  </section>;
}
