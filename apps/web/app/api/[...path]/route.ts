// Serves the partner API at /api/v1/… and /api/health by forwarding each request to
// the Fastify app from apps/api (listening on localhost), so the API behaves exactly
// as it does in its tests.

import { after } from "next/server";
import { getBackend, sweep } from "../../../lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set(["connection", "content-length", "transfer-encoding", "keep-alive"]);

async function handle(req: Request): Promise<Response> {
  try {
    return await serve(req);
  } catch (err) {
    // Startup failures (bad DATABASE_URL, a module that won't load) land here instead
    // of a blank 500. The message names the problem without echoing the connection string.
    console.error("api: request failed", err);
    const e = err as { name?: string; code?: string; message?: string };
    return Response.json(
      { error: { code: "server_error", message: `${e.name ?? "Error"}${e.code ? ` (${e.code})` : ""}: ${e.message ?? String(err)}` } },
      { status: 500 },
    );
  }
}

async function serve(req: Request): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: { code: "not_configured", message: "The API isn't connected to a database yet." } }, { status: 503 });
  }
  const { baseUrl } = await getBackend();
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k) && k !== "host") headers.set(k, v);
  });
  const res = await fetch(baseUrl + url.pathname.replace(/^\/api/, "") + url.search, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    redirect: "manual",
  });
  const body = await res.arrayBuffer();

  // Deliver webhooks and retry stuck orders once the response is on its way.
  after(() => sweep().catch((err) => console.error("sweep failed", err)));

  const out = new Headers();
  res.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k) && k !== "content-encoding") out.set(k, v);
  });
  return new Response(body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST };
