// Serves the partner API at /api/v1/… and /api/health by handing each request to
// the Fastify app from apps/api, so the API behaves exactly as it does in its tests.

import { after } from "next/server";
import { getBackend, sweep } from "../../../lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set(["connection", "content-length", "transfer-encoding", "keep-alive"]);

async function handle(req: Request): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: { code: "not_configured", message: "The API isn't connected to a database yet." } }, { status: 503 });
  }
  const { app } = await getBackend();
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k) && k !== "host") headers[k] = v;
  });
  const res = await app.inject({
    method: req.method as "GET" | "POST",
    url: url.pathname.replace(/^\/api/, "") + url.search,
    headers,
    payload: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
  });

  // Deliver webhooks and retry stuck orders once the response is on its way.
  after(() => sweep().catch((err) => console.error("sweep failed", err)));

  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  return new Response(res.body, { status: res.statusCode, headers: out });
}

export { handle as GET, handle as POST };
