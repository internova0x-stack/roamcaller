// Shared pieces of the hosted eSIM screens.

import type { ReactNode } from "react";
import { getCore } from "../../lib/backend";
import { resolveEmbedSession, type EmbedSession, type Partner } from "@roam/core";

export interface Ctx {
  token: string;
  session: EmbedSession;
  partner: Partner;
}

/** The session behind ?t=…, or null when the link is missing, unknown or expired. */
export async function loadCtx(searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<Ctx | null> {
  const t = (await searchParams).t;
  const token = Array.isArray(t) ? t[0] : t;
  if (!token || !process.env.DATABASE_URL) return null;
  const found = await resolveEmbedSession(getCore().db, token);
  return found ? { token, ...found } : null;
}

export function withToken(path: string, token: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** 🇦🇪 from "AE"; a globe for regional plans. */
export function flag(coverage: string[]): string {
  if (coverage.length !== 1 || !/^[A-Z]{2}$/.test(coverage[0]!)) return "🌍";
  return String.fromCodePoint(...[...coverage[0]!].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function dataLabel(mb: number | null): string {
  if (mb === null) return "Data";
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`;
}

const SYMBOL: Record<string, string> = { USD: "$", NGN: "₦", GHS: "GH₵", KES: "KSh ", ZAR: "R", EGP: "E£", GBP: "£", EUR: "€" };
export function money(p: { display: string; currency: string }): string {
  const s = SYMBOL[p.currency];
  return s ? `${s}${p.display}` : `${p.display} ${p.currency}`;
}

export function Shell(props: { ctx: Ctx; tab: "plans" | "mine" | null; children: ReactNode }) {
  const { ctx, tab } = props;
  return (
    <div className="esim">
      <header className="e-top">
        <div className="row">
          <div>
            <div className="who">{ctx.partner.name} · Travel eSIM</div>
            <div className="powered">Powered by Roam Caller{ctx.session.mode === "test" ? " · Sandbox" : ""}</div>
          </div>
        </div>
        <nav className="e-tabs" aria-label="eSIM">
          <a href={withToken("/esim", ctx.token)} aria-current={tab === "plans" ? "page" : undefined}>
            Plans
          </a>
          <a href={withToken("/esim/mine", ctx.token)} aria-current={tab === "mine" ? "page" : undefined}>
            My eSIMs
          </a>
        </nav>
      </header>
      <main className="e-main">{props.children}</main>
    </div>
  );
}

export function Expired() {
  return (
    <div className="esim">
      <main className="e-main">
        <div className="e-card e-empty">
          <h1 style={{ fontSize: 22 }}>This link has expired</h1>
          <p className="e-muted">Go back to the app and open Travel eSIM again.</p>
        </div>
      </main>
    </div>
  );
}
