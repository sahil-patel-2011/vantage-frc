/**
 * Local Postgres proxy that adds a fixed delay to each server response burst.
 *
 * A burst is one round trip: node-postgres writes a query and the server answers.
 * Delaying that answer by 20ms or 40ms stands in for Vercel talking to a remote
 * database. The app's DATABASE_URL points here; the database stays on 127.0.0.1.
 *
 *   node scripts/pg-latency-proxy.mjs
 *   curl -X POST http://127.0.0.1:5434/delay/40
 *   curl http://127.0.0.1:5434/reset
 *   curl http://127.0.0.1:5434/
 *
 * Stats are response bursts since the last reset: total, and the busiest connection.
 */
import http from "node:http";
import net from "node:net";

const listenPort = Number(process.env.PG_PROXY_PORT ?? 5433);
const targetPort = Number(process.env.PG_PROXY_TARGET ?? 5432);
const statsPort = Number(process.env.PG_PROXY_STATS_PORT ?? 5434);

let delayMs = Number(process.env.PG_PROXY_DELAY_MS ?? 0);
let total = 0;
const perSocket = new Map();
let nextId = 1;

function bump(id) {
  total += 1;
  perSocket.set(id, (perSocket.get(id) ?? 0) + 1);
}

function stats() {
  let maxConnection = 0;
  for (const count of perSocket.values()) maxConnection = Math.max(maxConnection, count);
  return { delayMs, total, maxConnection, connections: perSocket.size };
}

function reset() {
  total = 0;
  perSocket.clear();
}

function pipeWithDelay(from, to, id) {
  let buffer = [];
  let timer = null;
  const flush = () => {
    timer = null;
    const chunks = buffer;
    buffer = [];
    if (chunks.length === 0) return;
    bump(id);
    for (const chunk of chunks) to.write(chunk);
  };
  from.on("data", (chunk) => {
    buffer.push(chunk);
    // setTimeout(0) still groups packets from one response into one burst,
    // so a 0ms run counts round trips instead of TCP fragments.
    if (!timer) timer = setTimeout(flush, Math.max(0, delayMs));
  });
  from.on("end", () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
    to.end();
  });
  from.on("error", () => to.destroy());
}

const server = net.createServer((client) => {
  const id = nextId;
  nextId += 1;
  perSocket.set(id, perSocket.get(id) ?? 0);
  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    pipeWithDelay(upstream, client, id);
  });
  client.on("data", (chunk) => upstream.write(chunk));
  client.on("end", () => upstream.end());
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => perSocket.delete(id));
});

server.listen(listenPort, "127.0.0.1");

http
  .createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname.startsWith("/delay/")) {
      delayMs = Math.max(0, Number(url.pathname.slice("/delay/".length)) || 0);
    } else if (url.pathname === "/reset") {
      reset();
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(stats()));
  })
  .listen(statsPort, "127.0.0.1");

console.log(`pg proxy listening on 127.0.0.1:${listenPort} -> 127.0.0.1:${targetPort}, stats on ${statsPort}, delay ${delayMs}ms`);
