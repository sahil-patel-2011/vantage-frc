#!/usr/bin/env node
/**
 * Serve audit-artifacts/ read-only on loopback so the GUI review can look at
 * the screenshots the walkthrough captured. Nothing here is part of the app.
 *
 *   node scripts/serve-artifacts.mjs [dir] [port]
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "audit-artifacts");
const port = Number(process.argv[3] ?? 3477);
const TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

const escape = (value) => value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const relative = url.replace(/^\/+/, "");
  const file = join(root, relative);
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    const entries = readdirSync(file, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const href = `${url.replace(/\/$/, "")}/${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`;
        return `<li><a href="${href}">${escape(entry.name)}${entry.isDirectory() ? "/" : ""}</a></li>`;
      })
      .join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Audit artifacts</title>
<body style="font:14px/1.6 system-ui;padding:24px;max-width:900px"><h1 style="font-size:18px">${escape(relative || "/")}</h1><ul>${entries || "<li>empty</li>"}</ul>
<p><a href="/">root</a></p></body>`);
    return;
  }
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`artifacts on http://127.0.0.1:${port}/`);
});
