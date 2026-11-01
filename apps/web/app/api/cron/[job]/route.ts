// Scheduled jobs, called by Vercel Cron (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET variable is set.
//
//   /api/cron/maintenance  retry stuck orders, send webhooks, refresh eSIM usage
//   /api/cron/sync-plans   copy RoamBuddy's catalogue into the plans table

import { refreshEsims, syncPlans } from "@roam/core";
import type { Mode } from "@roam/db";
import { getBackend, sweep } from "../../../../lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { job } = await ctx.params;
  const { db, rbFor } = await getBackend();
  if (job === "maintenance") {
    const swept = await sweep(true);
    const esims = await refreshEsims(db, rbFor);
    return Response.json({ ok: true, ...swept, esimsChecked: esims });
  }
  if (job === "sync-plans") {
    const modes: Mode[] = process.env.ROAMBUDDY_LIVE_USERNAME ? ["test", "live"] : ["test"];
    const result: Record<string, unknown> = {};
    for (const mode of modes) result[mode] = await syncPlans(db, rbFor(mode), mode);
    return Response.json({ ok: true, ...result });
  }
  return Response.json({ error: `Unknown job ${job}` }, { status: 404 });
}
