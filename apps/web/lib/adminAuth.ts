// The admin page's sign-in: one shared password (ADMIN_PASSWORD in Vercel).
// A signed, httpOnly cookie keeps the admin signed in for 12 hours.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "rc_admin";
const HOURS = 12;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function adminConfigured(): boolean {
  return (process.env.ADMIN_PASSWORD ?? "").length >= 12;
}

export async function isAdmin(): Promise<boolean> {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret || !adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, sign(`admin:${exp}`, secret));
}

/** Checks the password and sets the cookie. Returns false for a wrong password. */
export async function signIn(password: string): Promise<boolean> {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret || !adminConfigured() || !same(sign("pw", password), sign("pw", secret))) return false;
  const exp = String(Date.now() + HOURS * 3600_000);
  (await cookies()).set(COOKIE, `${exp}.${sign(`admin:${exp}`, secret)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: HOURS * 3600,
  });
  return true;
}

export async function signOut(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
}
