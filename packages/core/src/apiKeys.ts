import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, partners, type Mode, type Tx } from "@roam/db";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Creates a key like `rc_test_…`. The full key is returned once and never stored. */
export async function createApiKey(tx: Tx, partnerId: string, mode: Mode): Promise<string> {
  const key = `rc_${mode}_${randomToken(32)}`;
  await tx.insert(apiKeys).values({ partnerId, mode, prefix: key.slice(0, 12), hash: hashKey(key) });
  return key;
}

export type Partner = typeof partners.$inferSelect;

export async function authenticateKey(tx: Tx, key: string): Promise<{ partner: Partner; mode: Mode } | null> {
  if (!/^rc_(test|live)_[0-9A-Za-z]{32}$/.test(key)) return null;
  const rows = await tx
    .select({ partner: partners, keyId: apiKeys.id, mode: apiKeys.mode })
    .from(apiKeys)
    .innerJoin(partners, eq(partners.id, apiKeys.partnerId))
    .where(and(eq(apiKeys.hash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));
  return { partner: row.partner, mode: row.mode };
}
