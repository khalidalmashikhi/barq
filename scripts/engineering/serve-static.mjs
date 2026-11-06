#!/usr/bin/env node
// Minimal static file server for the built Storybook (design lab visual tests) — no dependency.
//
//   node scripts/engineering/serve-static.mjs <dir> <port>
//
// Binds to 127.0.0.1 ONLY (never 0.0.0.0 / the local network). Serves files strictly inside <dir>
// (no path traversal); GET/HEAD only; no directory listings.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const [dirArg = "storybook-static", portArg = "6007"] = process.argv.slice(2);
const root = path.resolve(dirArg);
const port = Number(portArg);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".ico": "image/x-icon", ".map": "application/json" };

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let file = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
    const stat = statSync(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": stat.size, "cache-control": "no-store" });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});

server.listen(port, "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
