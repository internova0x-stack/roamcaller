import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

export function connect(url = process.env.DATABASE_URL, opts: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  if (!url) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(url);
  // Supabase's transaction pooler (port 6543) can't keep prepared statements, and
  // "pgbouncer=true" is a Prisma-only flag that Postgres would reject.
  parsed.searchParams.delete("pgbouncer");
  const pooled = parsed.port === "6543";
  const sql = postgres(parsed.toString(), { max: opts.max ?? 10, prepare: !pooled, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}

// A plain path, not new URL(…, import.meta.url): bundlers would try to bundle that folder.
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
