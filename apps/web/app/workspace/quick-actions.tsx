"use client";
import { useEffect } from "react";
export default function QuickActions({ orgId }: { orgId: string }) {
  const actions: Array<[string, string, string, string]> = [
    ["S","Scout now","Open offline form",`/scouting?orgId=${orgId}`],
    ["P","Pit command","Release robot + log battery",`/pit?orgId=${orgId}`],
    ["I","Team intel","Lookup or compare",`/intel?orgId=${orgId}`],
    ["D","Team dossier","Season fact cards",`/dossier?orgId=${orgId}`],
    ["A","Ask AI","Plan with context",`/chat?orgId=${orgId}`],
    ["C","CAD agent","Bind Onshape, then sketch live",`/cad?orgId=${orgId}`],
  ];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = actions.find(([key]) => key.toLowerCase() === event.key.toLowerCase());
      if (action) window.location.assign(action[3]);
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });
  return <section className="quick-actions" aria-label="Competition quick actions">
    {actions.map(([key,title,copy,href], index) => <a className={`quick ${index === 0 ? "primary" : ""}`} href={href} key={key}><span>{title}</span><strong>{copy}</strong><kbd>{key}</kbd></a>)}
  </section>;
}
