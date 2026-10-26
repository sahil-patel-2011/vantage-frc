"use client";
import { useEffect } from "react";
import { Button, PageToolbar } from "../../components/ui";

const ACTIONS = [
  { key: "S", title: "Scout now", copy: "Open offline form", path: "/scouting", intent: "primary" as const },
  { key: "P", title: "Pit command", copy: "Release robot + log battery", path: "/pit", intent: "secondary" as const },
  { key: "I", title: "Team intel", copy: "Lookup or compare", path: "/intel", intent: "secondary" as const },
  { key: "D", title: "Team dossier", copy: "Season fact cards", path: "/dossier", intent: "secondary" as const },
  { key: "A", title: "Ask AI", copy: "Plan with context", path: "/chat", intent: "secondary" as const },
  { key: "C", title: "CAD agent", copy: "Bind Onshape, then sketch live", path: "/cad", intent: "secondary" as const },
];

export default function QuickActions({ orgId }: { orgId: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = ACTIONS.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
      if (action) window.location.assign(`${action.path}?orgId=${orgId}`);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [orgId]);
  return (
    <section className="quick-actions" aria-label="Competition quick actions">
      <PageToolbar label="Competition quick actions">
        {ACTIONS.map((action) => (
          <Button
            key={action.key}
            as="a"
            variant={action.intent === "primary" ? "primary" : "secondary"}
            href={`${action.path}?orgId=${orgId}`}
            title={action.copy}
          >
            {action.title}
            <kbd>{action.key}</kbd>
          </Button>
        ))}
      </PageToolbar>
    </section>
  );
}
