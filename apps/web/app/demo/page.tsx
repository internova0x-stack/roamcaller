// Partner demo: the hosted eSIM screens in a phone frame, as they'd appear inside a
// partner's app. Uses the demo partner (DEMO_PARTNER_KEY) in test mode, and a fresh
// demo traveller on every visit so "My eSIMs" starts empty.

import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { partners } from "@roam/db";
import { account, balance, createEmbedSession, creditPartner } from "@roam/core";
import { getCore } from "../../lib/backend";
import "./demo.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner demo", robots: { index: false, follow: false } };

/** Keeps the shared demo balance from running dry: back to about $1,000 when under $100. */
const TOP_UP: Record<string, { floor: number; to: number }> = {
  USD: { floor: 10_000, to: 100_000 },
  NGN: { floor: 15_500_000, to: 155_000_000 },
};

async function demoSession(): Promise<{ url: string; partnerName: string } | { problem: string }> {
  if (!process.env.DATABASE_URL) return { problem: "The demo isn't connected to a database yet." };
  const { db } = getCore();
  const [partner] = await db.select().from(partners).where(eq(partners.slug, "demo"));
  if (!partner) return { problem: "No demo partner yet: set DEMO_PARTNER_KEY in Vercel and redeploy." };

  const rule = TOP_UP[partner.currency];
  if (rule) {
    const have = await balance(db, account.partner("test", partner.id), partner.currency);
    if (have < rule.floor) {
      await db.transaction((tx) =>
        creditPartner(tx, { mode: "test", partnerId: partner.id, currency: partner.currency, amountMinor: rule.to - have, ref: `demo-topup-${Date.now()}` }),
      );
    }
  }
  const { token } = await createEmbedSession(db, { partnerId: partner.id, mode: "test", customerRef: `demo-${randomBytes(4).toString("hex")}` });
  return { url: `/esim?t=${token}`, partnerName: partner.name };
}

export default async function DemoPage() {
  const demo = await demoSession();

  return (
    <div className="demo">
      <header className="demo-nav">
        <a className="demo-logo" href="/">
          <span className="mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M5 12a7 7 0 0 1 14 0" />
              <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
              <circle cx="12" cy="16" r="1.6" fill="currentColor" />
            </svg>
          </span>
          Roam Caller
        </a>
        <span className="demo-tag">Partner demo · Sandbox</span>
      </header>

      <main className="demo-main">
        <section className="demo-copy">
          <h1>Travel eSIMs inside your app</h1>
          <p>
            This is what your customers see when they tap <b>Travel eSIM</b> in your app. Try it: pick a destination, pay, and install. It runs in
            our sandbox, so no real money or eSIMs are used.
          </p>
          <ol>
            <li>
              <b>Your app opens our screens</b> for a signed-in customer, with one call to our API.
            </li>
            <li>
              <b>Your customer pays from their balance</b> with you. We draw the cost from your prepaid balance with us.
            </li>
            <li>
              <b>The eSIM arrives in seconds:</b> one-tap install on iPhone, a QR code, or manual codes.
            </li>
            <li>
              <b>"My eSIMs" shows data left</b>, and your server gets webhooks for each order and when data runs low.
            </li>
          </ol>
          <p className="demo-small">
            Prefer your own screens? The same features are in our API. Docs and test keys are available on request.
          </p>
        </section>

        <section className="demo-phone-wrap" aria-label="Phone preview">
          {"url" in demo ? (
            <div className="demo-phone">
              <iframe title={`${demo.partnerName} travel eSIM screens`} src={demo.url} />
            </div>
          ) : (
            <div className="demo-problem">{demo.problem}</div>
          )}
          {"url" in demo ? (
            <a className="demo-open" href={demo.url} target="_blank" rel="noreferrer">
              Open full screen
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
