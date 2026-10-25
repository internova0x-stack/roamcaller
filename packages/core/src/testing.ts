// Test harness: a fresh Postgres database per test file plus a mock RoamBuddy.
// Needs TEST_DATABASE_URL pointing at a server where we may create databases,
// e.g. postgres://postgres@127.0.0.1:5432/postgres

import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { connect, fxRates, partners, runMigrations, type Db, type Mode } from "@roam/db";
import { RoamBuddyClient } from "@roam/roambuddy";
import { createMockRoamBuddy, newMockState, type MockState } from "@roam/roambuddy/mock";
import { creditPartner, syncPlans, type Partner, type RoamBuddyFor } from "./index.ts";

export interface Harness {
  db: Db;
  rbFor: RoamBuddyFor;
  mock: MockState;
  close(): Promise<void>;
}

export async function setup(): Promise<Harness> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("Set TEST_DATABASE_URL to run these tests");
  const name = `roam_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const { db, close } = connect(url.toString());
  await runMigrations(db);

  const { server, state } = createMockRoamBuddy(newMockState());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const client = new RoamBuddyClient({ baseUrl: `http://127.0.0.1:${port}/api/v1`, username: "test", password: "test" });
  const rbFor: RoamBuddyFor = () => client;

  await db.insert(fxRates).values({ currency: "NGN", perUsd: "1550" });
  await syncPlans(db, client, "test");

  return {
    db,
    rbFor,
    mock: state,
    async close() {
      server.close();
      await close();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export async function makePartner(db: Db, opts: { balanceMinor?: number; currency?: string; mode?: Mode } = {}): Promise<Partner> {
  const [p] = await db
    .insert(partners)
    .values({ name: "Test Fintech", slug: `fintech-${randomUUID().slice(0, 8)}`, currency: opts.currency ?? "NGN", markupBps: 2000 })
    .returning();
  if (opts.balanceMinor) {
    await db.transaction((tx) =>
      creditPartner(tx, { mode: opts.mode ?? "test", partnerId: p!.id, currency: p!.currency, amountMinor: opts.balanceMinor!, ref: `seed-${p!.id}` }),
    );
  }
  return p!;
}
