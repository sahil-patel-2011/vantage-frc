/**
 * @vantage/connector — shared core of the ONE downloadable Vantage connector.
 *
 * One pairing, one device identity, several independently toggleable capabilities:
 * ai-bridge, cad-relay, local-models, agent-sync, storage-node, mcp. Two hosts consume
 * this package: the Electron desktop app and a headless CLI for an always-on box or
 * Raspberry Pi. Plain Node (>= 20), zero runtime dependencies, no native modules; every
 * environment access (network, processes, filesystem, clock) is an injected port so the
 * core is fully unit-testable. Real Node adapters: `@vantage/connector/node`.
 *
 * See docs/CONNECTOR.md for the host-integration and server-wiring contract.
 */

export { CONNECTOR_VERSION, CANONICAL_BASE_URL, defaultBaseUrl } from "./version.js";

export {
  joinPath,
  readIfExists,
  dirExists,
  fileExists,
  type Clock,
  type FileSystemLike,
  type FileStat,
  type JsonHttpTransport,
  type JsonResponse,
  type Logger,
  type Spawner,
  type SpawnRunResult,
  type SpawnSyncResult,
} from "./ports.js";

export {
  DEFAULT_CONNECTOR_ENDPOINTS,
  resolveEndpoints,
  cloudUrl,
  type ConnectorEndpoints,
} from "./endpoints.js";

export {
  CAPABILITY_IDS,
  ConnectorAuthError,
  isCapabilityId,
  type CapabilityContext,
  type CapabilityDetection,
  type CapabilityId,
  type CapabilityReport,
  type ConnectorCapability,
} from "./capability.js";

export {
  CONNECTOR_CONFIG_FILENAME,
  LEGACY_BRIDGE_CONFIG_FILENAME,
  adoptLegacyBridgeConfig,
  connectorConfigDir,
  connectorConfigPath,
  defaultCapabilities,
  enabledCapabilities,
  isCapabilityEnabled,
  legacyBridgeConfigPath,
  loadConnectorConfig,
  loadOrAdoptConnectorConfig,
  parseConnectorConfig,
  saveConnectorConfig,
  setCapabilityEnabled,
  type CapabilityToggleMap,
  type ConnectorConfig,
  type LoadOrAdoptResult,
} from "./config.js";

export {
  RUNTIME_STATE_FILENAME,
  parseRuntimeState,
  readRuntimeState,
  runtimeStatePath,
  snapshotFromStatus,
  writeRuntimeState,
  type ConnectorRuntimeState,
  type RuntimeCapabilitySnapshot,
} from "./runtime-state.js";

export {
  PairingFlow,
  configFromPairing,
  type ApprovedPairing,
  type PairingFlowOptions,
  type PairingStartResponse,
  type PairingState,
} from "./pairing.js";

export {
  ConnectorSupervisor,
  DETECT_RETRY_MS,
  HEALTHY_RESET_MS,
  HEARTBEAT_INTERVAL_MS,
  RESTART_BACKOFF_MS,
  restartDelayMs,
  type CapabilityRunState,
  type CapabilityStatusEntry,
  type ConnectorStatusReport,
  type ConnectorSupervisorOptions,
  type SupervisorEvent,
} from "./supervisor.js";

export {
  AI_BRIDGE_CLAIM_INTERVAL_MS,
  AI_BRIDGE_DEFAULT_JOB_TIMEOUT_MS,
  AiBridgeCapability,
  classifySpawnFailure,
  detectClaude,
  detectCodex,
  detectEngines,
  detectRateLimit,
  executeClaude,
  executeCodex,
  jobTimeoutMs,
  parseClaudeCliOutput,
  pickEngine,
  type BridgeExecutionResult,
  type EngineDetection,
  type EngineId,
  type EngineMap,
} from "./ai-bridge.js";

export {
  LM_STUDIO_BASE_URL,
  LOCAL_MODEL_RESCAN_INTERVAL_MS,
  LocalModelsCapability,
  OLLAMA_BASE_URL,
  applyLmStudioContextLengths,
  discoverLocalModels,
  normalizeOllamaTags,
  normalizeOpenAiModelList,
  probeLmStudio,
  probeOllama,
  probeOpenAiCompatible,
  type LocalModel,
  type LocalModelDiscovery,
  type LocalModelProvider,
  type LocalModelSource,
} from "./local-models.js";

export {
  AGENT_CONFIG_BUNDLE_SCHEMA,
  AGENT_SYNC_INTERVAL_MS,
  AgentSyncCapability,
  CURSOR_GENERATED_BANNER,
  CURSOR_MCP_FILE,
  CURSOR_RULES_DIR,
  CURSOR_SKILLS_DIR,
  PERMISSIONS_SUGGESTION_FILE,
  TEAM_RULES_FILE,
  VANTAGE_BEGIN_MARKER,
  VANTAGE_END_MARKER,
  VANTAGE_MCP_PREFIX,
  applyVantageMarkerBlock,
  buildClaudeMdBlock,
  buildCursorRuleMdc,
  buildPermissionsSuggestion,
  buildTeamRulesMarkdown,
  cursorSkillFolder,
  detectAgentTargets,
  materializeAgentConfig,
  mergeMcpServers,
  parseAgentConfigBundle,
  parseRuleScope,
  pruneManagedMdcDir,
  safeConfigName,
  type AgentConfigBundle,
  type AgentSyncSummary,
  type AgentSyncTargets,
  type McpMergeResult,
  type RuleScope,
} from "./agent-sync.js";

export {
  PAIRING_CODE_ALPHABET,
  SHA256_RE,
  STORAGE_DEFAULT_PORT,
  STORAGE_DEFAULT_QUOTA_GB,
  StorageNodeCapability,
  computeScrubReport,
  formatBytes,
  isValidSha256,
  lanUrlsFor,
  normalizePairingCode,
  parseRange,
  quotaDecision,
  sha256Hex,
  shardRelPath,
  timingSafeEqualHex,
  type StorageNodeCapabilityOptions,
  type StorageServeFn,
  type StorageServeOptions,
  type StorageServerHandle,
  type StorageServerState,
} from "./storage-node.js";

export {
  CAD_RELAY_CLAIM_INTERVAL_MS,
  CAD_RELAY_EXECUTE_TIMEOUT_MS,
  CadRelayCapability,
  DEFAULT_FUSION_PLUGIN_ENDPOINT,
  validatePluginEndpoint,
} from "./cad-relay.js";

export {
  MCP_PROTOCOL_VERSION,
  McpCapability,
  McpFrameDecoder,
  combineToolRegistries,
  connectorStatusToolRegistry,
  dispatchConnectorMcp,
  emptyToolRegistry,
  encodeMcpFrame,
  runConnectorMcp,
  type JsonRpcMessage,
  type McpHooks,
  type McpToolDefinition,
  type McpToolRegistry,
  type McpWrite,
} from "./mcp.js";
