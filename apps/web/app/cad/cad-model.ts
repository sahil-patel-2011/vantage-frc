export type BoundDoc = {
  documentId?: string;
  workspaceId?: string;
  elementId?: string;
  documentName?: string | null;
  url?: string | null;
};

export type ChatMessage = { role: "user" | "assistant" | "tool"; text: string };

export type AgentMode = "simple" | "plan" | "multitask";

export type PlanStep = { index: number; title: string; detail: string };

export type AgentPlan = {
  brief: string;
  steps: PlanStep[];
  questions: string[];
  answers: string[];
  approved: boolean;
};

export type AgentStep = {
  index: number;
  tool: string;
  label: string;
  title: string;
  detail: string;
  status: "done" | "failed";
  featureId: string | null;
  at: string;
};

export type AgentTask = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  note: string;
};

export type ModeState = {
  mode: AgentMode;
  proposal: { mode: AgentMode; proposedAt: string; expiresAt: string } | null;
  plan: AgentPlan | null;
  tasks: AgentTask[] | null;
};

export type AgentState = {
  onshapeConfigured: boolean;
  onshapeConnected: boolean;
  bound: BoundDoc | null;
  iframeUrl: string | null;
  openUrl: string | null;
  shadedPngBase64?: string | null;
  messages: ChatMessage[];
  /** Narrated build steps for this session, newest turn last. */
  steps?: AgentStep[];
  modeState?: ModeState | null;
};

export type ChatResponse = {
  error?: string;
  code?: string;
  text?: string;
  messages?: ChatMessage[];
  steps?: AgentStep[];
  modeState?: ModeState | null;
  proposal?: { mode: AgentMode; reasons: string[]; expiresAt: string } | null;
  shadedPngBase64?: string | null;
};

export const MODE_LABELS: Record<AgentMode, string> = {
  simple: "Simple",
  plan: "Plan",
  multitask: "Multitask",
};

export const TASK_STATUS_LABELS: Record<AgentTask["status"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
  failed: "Failed",
};

export type CadLoadFailure = { status: number | null; message: string };

export type CadBusy = "load" | "bind" | "chat" | "mode" | null;

export function activityRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
