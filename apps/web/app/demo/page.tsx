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
              <div className="demo-screen">
                <div className="demo-status" aria-hidden="true">
                  <span className="time">9:41</span>
                  <span className="island" />
                  <span className="icons">
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
                      <rect x="0" y="8" width="3" height="4" rx="1" />
                      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                      <rect x="10" y="3" width="3" height="9" rx="1" />
                      <rect x="15" y="0" width="3" height="12" rx="1" />
                    </svg>
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
                      <path d="M8 2.2c2.2 0 4.2.8 5.7 2.2l1.2-1.3A10 10 0 0 0 8 .4 10 10 0 0 0 1.1 3.1l1.2 1.3A8.2 8.2 0 0 1 8 2.2Z" />
                      <path d="M8 5.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.6 6.6 0 0 0 8 3.8c-1.7 0-3.3.6-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Z" />
                      <circle cx="8" cy="10" r="1.8" />
                    </svg>
                    <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
                      <rect x="0.5" y="0.5" width="22" height="11" rx="3.5" stroke="currentColor" opacity=".5" />
                      <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
                      <path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4Z" fill="currentColor" opacity=".5" />
                    </svg>
                  </span>
                </div>
                <iframe title={`${demo.partnerName} travel eSIM screens`} src={demo.url} />
                <span className="demo-home" aria-hidden="true" />
              </div>
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
