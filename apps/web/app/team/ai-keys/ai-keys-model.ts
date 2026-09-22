import type { ByokKeyStatus, ByokProvider } from "../../../lib/ai-keys/byok-providers";

export type ProviderMeta = {
  id: ByokProvider;
  label: string;
  placeholder: string;
  docsHint: string;
};

export type ModelOption = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  tier: string;
  tierLabel: string;
};

export type LocalConnector = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  hasKey: boolean;
  lastTestedAt: string | null;
  reachabilityWarning: string | null;
};

export type RoutingPrefs = {
  mode: "fixed" | "automode";
  fixedModelId: string | null;
  enabledModelIds: string[];
  /**
   * Which free-swarm model this team prefers, or null for any of them.
   *
   * A different question from the three above, which are about provider keys
   * the team pays for. This one is about the volunteer swarm, where the
   * trade is speed against quality on somebody else's hardware.
   */
  freeSwarmModel?: string | null;
};

/** One model Vantage will accept an answer from on the volunteer swarm. */
export type FreeSwarmModel = { id: string; label: string; note: string };

export type FreeSwarm = {
  /** Whether the deployment has the pool turned on at all. */
  enabled: boolean;
  models: FreeSwarmModel[];
};

export type ModelPolicyMode = "allow_all" | "allowlist" | "force_auto";

export type ModelPolicyPayload = {
  mode: ModelPolicyMode;
  allowedModelIds: string[];
  canManage: boolean;
  catalog: ModelOption[];
};

export type MemberKeyRow = {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
};

export type Payload = {
  tier: string;
  canManage: boolean;
  keys: ByokKeyStatus[];
  memberKeys?: MemberKeyRow[];
  providers: ProviderMeta[];
  localConnector?: LocalConnector;
  routing?: RoutingPrefs;
  modelOptions?: ModelOption[];
  freeSwarm?: FreeSwarm;
  setupRequired?: boolean;
  setupMessage?: string | null;
  error?: string;
};

export type MineDraft = { provider: string; apiKey: string; baseUrl: string; model: string };
export type LocalDraft = { baseUrl: string; model: string; apiKey: string };
