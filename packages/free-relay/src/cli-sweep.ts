import { runFreeRelaySweep } from "./worker";
import { describeFreeRelayBackend } from "./adapter";

const intervalMs = Number(process.env.FREE_RELAY_INTERVAL_MS ?? "300000");

async function once() {
  const result = await runFreeRelaySweep();
  const stamp = new Date().toISOString();
  console.log(
    `[free-relay ${stamp}] backend=${describeFreeRelayBackend()} scheduled=${result.scheduled} processed=${result.processed} completed=${result.completed} failed=${result.failed} skipped=${result.skipped}${result.reason ? ` reason=${result.reason}` : ""}`,
  );
}

if (process.argv.includes("--once")) {
  once().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.log(
    `Free relay worker starting (interval ${intervalMs}ms, backend=${describeFreeRelayBackend()})`,
  );
  setInterval(() => {
    once().catch((error) => console.error("[free-relay]", error));
  }, intervalMs);
  once().catch((error) => console.error("[free-relay]", error));
}
