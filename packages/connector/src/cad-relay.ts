import type {
  CapabilityContext,
  CapabilityDetection,
  CapabilityReport,
  ConnectorCapability,
} from "./capability.js";
import { ConnectorAuthError } from "./capability.js";
import { cloudUrl } from "./endpoints.js";

/**
 * cad-relay capability — forward signed Fusion 360 jobs from the team's Vantage queue to
 * the VantageCadRelay add-in running inside Fusion on THIS machine. Faithful port of the
 * Fusion branch of `vantage-cad start` (packages/vantage-cad-cli/src/cli.ts) plus the
 * plugin health probe from packages/vantage-cad-cli/src/platform.ts, with network access
 * behind the injected transport so the loop is unit-testable.
 *
 * The add-in verifies each envelope's HMAC signature itself (packages/cad/src/fusion-relay.ts)
 * — this relay never needs, and never sees, the signing secret. Onshape teams do not need
 * this capability at all: Onshape jobs run hosted on the Vantage server.
 */

export const DEFAULT_FUSION_PLUGIN_ENDPOINT = "http://127.0.0.1:32145";
export const CAD_RELAY_CLAIM_INTERVAL_MS = 3_000;
export const CAD_RELAY_EXECUTE_TIMEOUT_MS = 120_000;
export const CAD_RELAY_HEALTH_TIMEOUT_MS = 2_500;

/** Loopback-only guard (ported from platform.ts validatePluginEndpoint). */
export function validatePluginEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Fusion plugin endpoint must be loopback HTTP");
  }
  return url;
}

export type CadRelayCapabilityOptions = {
  claimIntervalMs?: number;
  executeTimeoutMs?: number;
};

export class CadRelayCapability implements ConnectorCapability {
  readonly id = "cad-relay" as const;
  readonly label = "Fusion CAD relay";

  private jobsRelayed = 0;
  private lastHealth: { reachable: boolean; detail: string } | null = null;

  constructor(private readonly options: CadRelayCapabilityOptions = {}) {}

  private pluginEndpoint(ctx: CapabilityContext): URL {
    return validatePluginEndpoint(ctx.config.cadRelay?.pluginEndpoint ?? DEFAULT_FUSION_PLUGIN_ENDPOINT);
  }

  async detect(ctx: CapabilityContext): Promise<CapabilityDetection> {
    let plugin: URL;
    try {
      plugin = this.pluginEndpoint(ctx);
    } catch (error) {
      return { available: false, detail: error instanceof Error ? error.message : "Invalid plugin endpoint" };
    }
    try {
      const health = await ctx.transport.getJson(new URL("/health", plugin).toString(), {
        timeoutMs: CAD_RELAY_HEALTH_TIMEOUT_MS,
      });
      if (!health.ok) {
        this.lastHealth = { reachable: true, detail: `Plugin answered HTTP ${health.status}` };
        return { available: false, detail: `Fusion add-in answered HTTP ${health.status} at ${plugin}.` };
      }
      const version = typeof health.data.addinVersion === "string" ? health.data.addinVersion : null;
      this.lastHealth = { reachable: true, detail: `VantageCadRelay${version ? ` v${version}` : ""} reachable` };
      return {
        available: true,
        detail: `VantageCadRelay${version ? ` v${version}` : ""} reachable at ${plugin}.`,
        data: {
          addinVersion: version,
          documentName: typeof health.data.documentName === "string" ? health.data.documentName : null,
          operations: Array.isArray(health.data.operations) ? health.data.operations.map(String) : null,
        },
      };
    } catch {
      this.lastHealth = { reachable: false, detail: "Plugin unreachable" };
      return {
        available: false,
        detail: `Fusion plugin not reachable at ${plugin}. Run VantageCadRelay inside Fusion (Utilities → Add-Ins), then keep Fusion open.`,
      };
    }
  }

  async start(ctx: CapabilityContext): Promise<void> {
    const claimInterval = this.options.claimIntervalMs ?? CAD_RELAY_CLAIM_INTERVAL_MS;
    const executeTimeout = this.options.executeTimeoutMs ?? CAD_RELAY_EXECUTE_TIMEOUT_MS;
    const plugin = this.pluginEndpoint(ctx);
    const jobsUrl = cloudUrl(ctx.config.baseUrl, ctx.endpoints.cadRelayJobs);

    while (!ctx.signal.aborted) {
      let envelope: Record<string, unknown> | null = null;
      try {
        const claim = await ctx.transport.postJson(jobsUrl, {}, { token: ctx.config.deviceToken });
        if (claim.status === 401) {
          throw new ConnectorAuthError("CAD relay device token rejected — re-pair this connector.");
        }
        // 204 = nothing queued.
        if (claim.status === 200 && typeof claim.data.jobId === "string") envelope = claim.data;
      } catch (error) {
        if (error instanceof ConnectorAuthError) throw error;
        ctx.log(`cad-relay: claim failed (will retry): ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!envelope) {
        await ctx.clock.sleep(claimInterval, ctx.signal);
        continue;
      }

      // Forward the signed envelope to the add-in; it verifies signature + expiry itself.
      let state: "completed" | "failed" = "failed";
      let result: Record<string, unknown>;
      try {
        const executed = await ctx.transport.postJson(new URL("/execute", plugin).toString(), envelope, {
          timeoutMs: executeTimeout,
        });
        state = executed.ok ? "completed" : "failed";
        result = executed.data;
      } catch (error) {
        result = { error: error instanceof Error ? error.message : "Fusion plugin execution failed" };
      }
      try {
        await ctx.transport.postJson(
          jobsUrl,
          {
            jobId: envelope.jobId,
            stepId: envelope.stepId,
            leaseToken: envelope.leaseToken,
            state,
            progress: 100,
            result,
          },
          { method: "PATCH", token: ctx.config.deviceToken },
        );
        if (state === "completed") this.jobsRelayed += 1;
      } catch (error) {
        ctx.log(
          `cad-relay: could not report job result (${error instanceof Error ? error.message : String(error)}) — the lease will expire on its own.`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    // The claim loop honors ctx.signal; nothing else to release.
  }

  status(): CapabilityReport {
    return {
      detail: this.lastHealth
        ? `${this.lastHealth.detail}; ${this.jobsRelayed} job(s) relayed this session.`
        : "No plugin probe has run yet.",
      data: { jobsRelayedThisSession: this.jobsRelayed, plugin: this.lastHealth },
    };
  }
}
