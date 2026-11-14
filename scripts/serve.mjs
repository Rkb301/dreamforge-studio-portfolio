import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Production-only static server: no upload, filesystem API, or remote proxy.
const base = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const port = Number(process.env.DREAMFORGE_PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    const path = resolve(
      base,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!path.startsWith(base + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* http://[::1]:*; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found. Build Dreamforge with npm.cmd run build first.");
  }
});
server.on("error", (err) => {
  console.error(`Dreamforge could not start: ${err.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Dreamforge Studio: http://127.0.0.1:${port}`),
);
