"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, partners } from "@roam/db";
import { createApiKey, creditPartner } from "@roam/core";
import { getCore } from "../../lib/backend";
import { isAdmin, signIn, signOut } from "../../lib/adminAuth";

export type Result = { ok: true; title: string; secrets: { label: string; value: string }[] } | { ok: false; error: string } | null;

const CURRENCIES = new Set(["USD", "NGN"]);
const TOP_UP: Record<string, number> = { USD: 100_000, NGN: 155_000_000 }; // about $1,000

async function guard(): Promise<void> {
  if (!(await isAdmin())) throw new Error("Not signed in");
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 40) || "partner"
  );
}

export async function signInAction(_: Result, form: FormData): Promise<Result> {
  if (await signIn(String(form.get("password") ?? ""))) {
    revalidatePath("/admin");
    return null;
  }
  await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
  return { ok: false, error: "That password isn't right." };
}

export async function signOutAction(): Promise<void> {
  await signOut();
  revalidatePath("/admin");
}

/** Creates a partner with a sandbox key, a sandbox balance and, if a URL is given, a webhook secret. */
export async function createPartnerAction(_: Result, form: FormData): Promise<Result> {
  await guard();
  const name = String(form.get("name") ?? "").trim();
  const currency = String(form.get("currency") ?? "USD").toUpperCase();
  const markupPct = Number(form.get("markup") ?? 20);
  const webhookUrl = String(form.get("webhook_url") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the partner's name (2 to 80 characters)." };
  if (!CURRENCIES.has(currency)) return { ok: false, error: "Choose USD or NGN." };
  if (!Number.isFinite(markupPct) || markupPct < 0 || markupPct > 200) return { ok: false, error: "Markup must be between 0% and 200%." };
  if (webhookUrl && !/^https:\/\/\S+$/.test(webhookUrl)) return { ok: false, error: "The webhook address must start with https://." };

  const { db } = getCore();
  const out = await db.transaction(async (tx) => {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; (await tx.select({ id: partners.id }).from(partners).where(eq(partners.slug, slug))).length; i++) slug = `${base}-${i}`;
    const webhookSecret = webhookUrl ? `whsec_${randomBytes(24).toString("hex")}` : null;
    const [p] = await tx
      .insert(partners)
      .values({ name, slug, currency, markupBps: Math.round(markupPct * 100), webhookUrl: webhookUrl || null, webhookSecret })
      .returning();
    const key = await createApiKey(tx, p!.id, "test");
    await creditPartner(tx, { mode: "test", partnerId: p!.id, currency, amountMinor: TOP_UP[currency]!, ref: `initial-test-credit-${p!.id}` });
    return { key, webhookSecret };
  });
  revalidatePath("/admin");
  return {
    ok: true,
    title: `${name} is set up with a $1,000 sandbox balance`,
    secrets: [
      { label: "Sandbox API key", value: out.key },
      ...(out.webhookSecret ? [{ label: "Webhook signing secret", value: out.webhookSecret }] : []),
    ],
  };
}

export async function newKeyAction(_: Result, form: FormData): Promise<Result> {
  await guard();
  const partnerId = String(form.get("partner_id") ?? "");
  const { db } = getCore();
  const [p] = await db.select().from(partners).where(eq(partners.id, partnerId));
  if (!p) return { ok: false, error: "Partner not found." };
  const key = await createApiKey(db, p.id, "test");
  revalidatePath("/admin");
  return { ok: true, title: `New sandbox key for ${p.name}`, secrets: [{ label: "Sandbox API key", value: key }] };
}

export async function revokeKeyAction(form: FormData): Promise<void> {
  await guard();
  const keyId = String(form.get("key_id") ?? "");
  const { db } = getCore();
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)));
  revalidatePath("/admin");
}

export async function topUpAction(form: FormData): Promise<void> {
  await guard();
  const partnerId = String(form.get("partner_id") ?? "");
  const { db } = getCore();
  const [p] = await db.select().from(partners).where(eq(partners.id, partnerId));
  if (!p || !TOP_UP[p.currency]) return;
  await db.transaction((tx) =>
    creditPartner(tx, { mode: "test", partnerId: p.id, currency: p.currency, amountMinor: TOP_UP[p.currency]!, ref: `admin-topup-${Date.now()}` }),
  );
  revalidatePath("/admin");
}
