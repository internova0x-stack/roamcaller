// Background jobs. pg-boss keeps the schedule and the queue in Postgres, so running
// two workers is safe: each job runs once.
//
// | Job              | When                 | What                                                         |
// |------------------|----------------------|--------------------------------------------------------------|
// | advance-orders   | every minute         | Pushes stuck orders forward (uncertain completions, late QR) |
// | deliver-webhooks | every minute         | Sends partner webhooks, with retries                         |
// | refresh-esims    | every 30 minutes     | Updates data used; sends esim.data_low / esim.expired        |
// | check-wallet     | hourly               | Warns when the RoamBuddy wallet is below WALLET_ALERT_USD    |
// | sync-plans       | 02:10 Lagos, daily   | Copies RoamBuddy's catalogue into `plans`                    |

import { PgBoss } from "pg-boss";
import { connect, type Mode } from "@roam/db";
import { advanceStuckOrders, deliverWebhooks, refreshEsims, roamBuddyFromEnv, syncPlans, walletCents } from "@roam/core";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const { db } = connect(url);
const rbFor = roamBuddyFromEnv();
const boss = new PgBoss(url);
boss.on("error", (err) => log("error", "pg-boss", { error: err.message }));

/** Modes whose RoamBuddy account is configured. */
const modes: Mode[] = (["test", "live"] as const).filter((m) => process.env[m === "live" ? "ROAMBUDDY_LIVE_USERNAME" : "ROAMBUDDY_SANDBOX_USERNAME"]);
const alertCents = Math.round(Number(process.env.WALLET_ALERT_USD ?? 200) * 100);

const jobs: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: "advance-orders", cron: "* * * * *", run: () => advanceStuckOrders(db, rbFor) },
  { name: "deliver-webhooks", cron: "* * * * *", run: () => deliverWebhooks(db) },
  { name: "refresh-esims", cron: "*/30 * * * *", run: () => refreshEsims(db, rbFor) },
  {
    name: "check-wallet",
    cron: "7 * * * *",
    run: async () => {
      for (const mode of modes) {
        const cents = await walletCents(rbFor, mode);
        if (cents === null) log("warn", "check-wallet", { mode, message: "Could not read the RoamBuddy wallet balance" });
        else if (cents < alertCents) log("warn", "check-wallet", { mode, balanceUsd: cents / 100, message: "RoamBuddy wallet is low: top it up" });
        // TODO: email ALERT_EMAIL once the email provider is set up (build plan, Phase 1).
      }
    },
  },
  {
    name: "sync-plans",
    cron: "10 2 * * *",
    run: async () => {
      for (const mode of modes) log("info", "sync-plans", { mode, ...(await syncPlans(db, rbFor(mode), mode)) });
    },
  },
];

function log(level: "info" | "warn" | "error", job: string, data: object) {
  console[level === "info" ? "log" : level](JSON.stringify({ level, job, time: new Date().toISOString(), ...data }));
}

await boss.start();
for (const job of jobs) {
  await boss.createQueue(job.name);
  await boss.schedule(job.name, job.cron, null, { tz: "Africa/Lagos" });
  await boss.work(job.name, async () => {
    const started = Date.now();
    try {
      const result = await job.run();
      log("info", job.name, { ms: Date.now() - started, result });
    } catch (err) {
      log("error", job.name, { error: (err as Error).message });
      throw err;
    }
  });
}
// Fill the catalogue on startup instead of waiting for the nightly run.
await boss.send("sync-plans", {});
log("info", "worker", { message: "started", modes, jobs: jobs.map((j) => j.name) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  });
}
