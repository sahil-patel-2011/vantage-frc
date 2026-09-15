import type { AgentState, CadBusy } from "../../app/cad/cad-model";
import {
  AUTONOMOUS_LIVE_POLL_MAX_MS,
  AUTONOMOUS_LIVE_POLL_MS,
  nextAutonomousPollDelayMs,
} from "../agent/autonomous-live-poll";

/** Same cadence as the autonomous step poll — hop persist COMMITs mid-turn. */
export const CAD_LIVE_POLL_MS = AUTONOMOUS_LIVE_POLL_MS;
export const CAD_LIVE_POLL_MAX_MS = AUTONOMOUS_LIVE_POLL_MAX_MS;

export function nextCadLivePollDelayMs(consecutiveFailures: number): number {
  return nextAutonomousPollDelayMs(consecutiveFailures);
}

export function shouldPollCadLiveSession(busy: CadBusy): boolean {
  return busy === "chat";
}

/**
 * Overlay a mid-turn GET onto the open session. Keep a longer optimistic
 * transcript until the checkpointed messages catch up — never invent steps.
 */
export function mergeCadLiveSession(current: AgentState | null, incoming: AgentState): AgentState {
  if (!current) return incoming;
  const incomingMessages = incoming.messages ?? [];
  const currentMessages = current.messages ?? [];
  const incomingSteps = incoming.steps ?? [];
  return {
    ...incoming,
    messages: incomingMessages.length >= currentMessages.length ? incomingMessages : currentMessages,
    // Empty GET (pre-checkpoint) must not wipe the open pane. A shorter
    // this-turn hop list is still real — prefer it once any hop landed.
    steps: incomingSteps.length > 0 ? incomingSteps : current.steps,
    modeState: incoming.modeState !== undefined ? incoming.modeState : current.modeState,
  };
}
