// Admin: add partners and manage their sandbox API keys. Protected by ADMIN_PASSWORD.

import type { Metadata } from "next";
import { asc, desc } from "drizzle-orm";
import { apiKeys, partners } from "@roam/db";
import { account, balance, formatMinor } from "@roam/core";
import { getCore } from "../../lib/backend";
import { adminConfigured, isAdmin } from "../../lib/adminAuth";
import { revokeKeyAction, signOutAction, topUpAction } from "./actions";
import { CreatePartnerForm, NewKeyForm, RevokeButton, SignInForm } from "./forms";
import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

function when(d: Date | null): string {
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never";
}

export default async function AdminPage() {
  if (!adminConfigured()) {
    return (
      <div className="admin">
        <div className="a-card a-narrow">
          <h1>Admin isn't set up</h1>
          <p>Add an ADMIN_PASSWORD environment variable in Vercel (at least 12 characters), then redeploy.</p>
        </div>
      </div>
    );
  }
  if (!(await isAdmin())) {
    return (
      <div className="admin">
        <SignInForm />
      </div>
    );
  }
  if (!process.env.DATABASE_URL) {
    return (
      <div className="admin">
        <div className="a-card a-narrow">The site isn't connected to a database yet.</div>
      </div>
    );
  }

  const { db } = getCore();
  const list = await db.select().from(partners).orderBy(asc(partners.name));
  const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  const rows = await Promise.all(
    list.map(async (p) => ({
      partner: p,
      keys: keys.filter((k) => k.partnerId === p.id),
      sandbox: await balance(db, account.partner("test", p.id), p.currency),
    })),
  );

  return (
    <div className="admin">
      <header className="a-top">
        <b>Roam Caller admin</b>
        <form action={signOutAction}>
          <button className="a-link light">Sign out</button>
        </form>
      </header>
      <main className="a-main">
        <CreatePartnerForm />

        <h2 className="a-h">Partners ({rows.length})</h2>
        {rows.map(({ partner: p, keys: ks, sandbox }) => (
          <section key={p.id} className="a-card">
            <div className="a-head">
              <div>
                <h3>{p.name}</h3>
                <small>
                  {p.slug} · {p.currency} · {p.markupBps / 100}% markup · {p.status}
                  {p.webhookUrl ? ` · webhooks to ${p.webhookUrl}` : " · no webhook address"}
                </small>
              </div>
              <div className="a-balance">
                <small>Sandbox balance</small>
                <b>
                  {formatMinor(sandbox, p.currency)} {p.currency}
                </b>
                <form action={topUpAction}>
                  <input type="hidden" name="partner_id" value={p.id} />
                  <button className="a-link">Top up ~$1,000</button>
                </form>
              </div>
            </div>
            <table className="a-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Mode</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ks.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No keys yet.</td>
                  </tr>
                ) : (
                  ks.map((k) => (
                    <tr key={k.id} className={k.revokedAt ? "revoked" : undefined}>
                      <td>
                        <code>{k.prefix}…</code>
                      </td>
                      <td>{k.mode === "test" ? "Sandbox" : "Live"}</td>
                      <td>{when(k.createdAt)}</td>
                      <td>{when(k.lastUsedAt)}</td>
                      <td>{k.revokedAt ? `Revoked ${when(k.revokedAt)}` : <RevokeButton action={revokeKeyAction} keyId={k.id} />}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <NewKeyForm partnerId={p.id} />
          </section>
        ))}
        <p className="a-note">
          Only sandbox keys are created here: they use test balances and fake eSIMs. Live keys come once RoamBuddy is connected for
          real orders. The demo page uses the partner named by the "demo" slug.
        </p>
      </main>
    </div>
  );
}


