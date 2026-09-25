/**
 * Inbox text as people read it. Alerts stored before the wording was fixed still say
 * "21 scouting rows are uncovered at 2026gacmp: QM 31 · 2481"; they are said the new way on
 * display. Times are relative ("12 min ago", "Yesterday 9:52 PM"), never to the second.
 */

const LEVEL: Record<string, string> = { QM: "Qual", QF: "Quarter", SF: "Semi", F: "Final", EF: "Eighth" };

export function inboxText(text: string): string {
  return text
    .replace(/\b1 scouting row is uncovered at [a-z0-9]+/gi, "1 robot still needs scouting at this event")
    .replace(/\b(\d+) scouting rows are uncovered at [a-z0-9]+/gi, "$1 robots still need scouting at this event")
    .replace(/\b(QM|QF|SF|EF|F) (\d+)\b/g, (_all, level: string, n: string) => `${LEVEL[level] ?? level} ${n}`);
}

export function inboxWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}
