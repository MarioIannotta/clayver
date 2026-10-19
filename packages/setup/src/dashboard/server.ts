import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DASHBOARD_CONFIG_FILE } from "../constants.js";

/** Content types of the files a Vite build produces (and a few more). */
export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export interface DashboardServerOptions {
  /** Folder with the static dashboard build (index.html, assets/...). */
  root: string;
  /**
   * Returns the body of /clayver.config.json. Called on every request, so
   * edits to the file show up on the next page load.
   */
  readConfig: () => string | Buffer | undefined;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

function send(res: ServerResponse, req: IncomingMessage, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(buf.length), ...headers });
  res.end(req.method === "HEAD" ? undefined : buf);
}

function cacheControl(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}

function sendFile(res: ServerResponse, req: IncomingMessage, file: string, urlPath: string) {
  const size = statSync(file).size;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": contentTypeFor(file),
    "Content-Length": String(size),
    "Cache-Control": cacheControl(urlPath),
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * A small static file server for the prebuilt dashboard: GET/HEAD only, SPA
 * fallback to index.html for extension-less paths, the runtime config at
 * /clayver.config.json, and no way out of `root`.
 */
export function createDashboardServer(opts: DashboardServerOptions): Server {
  const root = resolve(opts.root);
  const index = join(root, "index.html");
  return createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, req, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    let urlPath: string;
    try {
      const raw = (req.url ?? "/").split("?")[0]!.split("#")[0]!;
      urlPath = decodeURIComponent(raw);
    } catch {
      send(res, req, 400, "Bad Request\n");
      return;
    }
    if (!urlPath.startsWith("/") || urlPath.includes("\0")) {
      send(res, req, 400, "Bad Request\n");
      return;
    }

    if (urlPath === `/${DASHBOARD_CONFIG_FILE}`) {
      const body = opts.readConfig();
      if (body === undefined) send(res, req, 404, "Not Found\n");
      else send(res, req, 200, body, { "Content-Type": CONTENT_TYPES[".json"]!, "Cache-Control": "no-store" });
      return;
    }

    // Reject anything that would leave the root, including encoded "..", "\" and absolute segments.
    const segments = urlPath.split(/[/\\]+/).filter(Boolean);
    if (segments.some((s) => s === ".." || s === ".")) {
      send(res, req, 403, "Forbidden\n");
      return;
    }
    const target = resolve(root, ...segments);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
      send(res, req, 403, "Forbidden\n");
      return;
    }
    // Dotfiles (e.g. .clayver-generated) are never served.
    if (segments.some((s) => s.startsWith("."))) {
      send(res, req, 404, "Not Found\n");
      return;
    }

    if (segments.length && isFile(target)) {
      sendFile(res, req, target, urlPath);
      return;
    }
    const last = segments[segments.length - 1] ?? "";
    // Missing assets are real 404s; everything else is a client-side route.
    if (extname(last) && extname(last) !== ".html") {
      send(res, req, 404, "Not Found\n");
      return;
    }
    if (!existsSync(index)) {
      send(res, req, 500, "index.html is missing from the dashboard build.\n");
      return;
    }
    sendFile(res, req, index, "/index.html");
  });
}

/** Listens on host:port. With `retry`, tries the next ports when one is taken. */
export function listen(server: Server, port: number, host: string, retry = 0): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const attempt = (p: number, left: number) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && left > 0) attempt(p + 1, left - 1);
        else reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        const addr = server.address();
        resolvePort(typeof addr === "object" && addr ? addr.port : p);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, host);
    };
    attempt(port, retry);
  });
}

/** The URL to print: loopback addresses are shown as localhost (an authorized Firebase Auth domain by default). */
export function displayUrl(host: string, port: number): string {
  const h = host === "127.0.0.1" || host === "::1" || host === "localhost" ? "localhost" : host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${h.includes(":") ? `[${h}]` : h}:${port}`;
}
