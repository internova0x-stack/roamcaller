// The partner API and background jobs, running inside the Vercel site.
// One Fastify app and one small database pool per server instance, created on first use.

import type { FastifyInstance } from "fastify";
import { buildApp } from "@roam/api/app";
import { connect, type Db } from "@roam/db";
import { advanceStuckOrders, deliverWebhooks, roamBuddyFromEnv, type RoamBuddyFor } from "@roam/core";

interface Backend {
  db: Db;
  rbFor: RoamBuddyFor;
  app: FastifyInstance;
  /** The API listening on a private local port, e.g. http://127.0.0.1:39211 */
  baseUrl: string;
}

let core: { db: Db; rbFor: RoamBuddyFor } | null = null;

/** The database and RoamBuddy client, for pages that use the core directly (the eSIM screens). */
export function getCore(): { db: Db; rbFor: RoamBuddyFor } {
  core ??= { db: connect(undefined, { max: 3 }).db, rbFor: roamBuddyFromEnv() };
  return core;
}

let backend: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  backend ??= (async () => {
    const { db, rbFor } = getCore();
    const app = buildApp({ db, rbFor, logger: { level: process.env.LOG_LEVEL ?? "warn" } });
    // Listening on localhost (rather than app.inject) avoids light-my-request, whose
    // ES-module dependency can't be loaded inside Vercel's bundled functions.
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    return { db, rbFor, app, baseUrl };
  })();
  backend.catch(() => {
    backend = null; // retry on the next request instead of caching a failure
  });
  return backend;
}

let lastSweep = 0;

/**
 * Sends due webhooks and retries stuck orders, at most once a minute per server
 * instance. Runs after API requests, because Vercel's Hobby plan only allows
 * daily cron jobs (see app/api/cron).
 */
export async function sweep(force = false): Promise<{ webhooks: { sent: number; failed: number }; advanced: number } | null> {
  if (!force && Date.now() - lastSweep < 60_000) return null;
  lastSweep = Date.now();
  const { db, rbFor } = await getBackend();
  const advanced = await advanceStuckOrders(db, rbFor);
  const webhooks = await deliverWebhooks(db);
  return { webhooks, advanced };
}
