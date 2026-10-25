import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export * from "./schema.ts";
export { schema };

export type Db = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

export function connect(url = process.env.DATABASE_URL): { db: Db; close: () => Promise<void> } {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
