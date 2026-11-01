// Plans: search by country or name, pick one.

import { plansForPartner } from "@roam/core";
import { getCore } from "../../lib/backend";
import { dataLabel, Expired, flag, loadCtx, money, Shell, withToken } from "./ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PlansPage({ searchParams }: Props) {
  const ctx = await loadCtx(searchParams);
  if (!ctx) return <Expired />;
  const qRaw = (await searchParams).q;
  const q = (Array.isArray(qRaw) ? qRaw[0] : qRaw)?.trim() ?? "";

  const all = await plansForPartner(getCore().db, ctx.partner, ctx.session.mode);
  // Sandbox test plans (country ZZ) are for developers, not travellers.
  const visible = all.filter((p) => !p.coverage.includes("ZZ"));
  const needle = q.toLowerCase();
  const shown = needle
    ? visible.filter((p) => p.name.toLowerCase().includes(needle) || p.coverage.some((c) => c.toLowerCase() === needle))
    : visible;

  return (
    <Shell ctx={ctx} tab="plans">
      <h1 style={{ fontSize: 24 }}>Where are you going?</h1>
      <form className="e-search" action="/esim" method="get" role="search">
        <input type="hidden" name="t" value={ctx.token} />
        <input id="q" name="q" defaultValue={q} placeholder="Country, e.g. United Kingdom" aria-label="Search destinations" autoComplete="off" />
        <button className="e-btn secondary" style={{ width: "auto", padding: "12px 16px" }} type="submit">
          Search
        </button>
      </form>
      {shown.length ? (
        <ul className="e-list">
          {shown.map((p) => (
            <li key={p.id}>
              <a className="e-plan" href={withToken(`/esim/plan/${p.id}`, ctx.token)}>
                <span className="e-flag" aria-hidden="true">
                  {flag(p.coverage)}
                </span>
                <span className="txt">
                  <b>{p.name}</b>
                  <span className="e-muted">
                    {dataLabel(p.data_mb)}
                    {p.validity_days ? ` · ${p.validity_days} days` : ""}
                  </span>
                </span>
                <span className="price">{money({ display: p.price.display, currency: p.price.currency })}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="e-card e-empty">
          <b>No plans match “{q}”.</b>
          <span className="e-muted">Try a country name, such as United Kingdom or Saudi Arabia.</span>
        </div>
      )}
      <p className="e-muted">Data only. Keep your home SIM on for calls, texts and bank codes.</p>
    </Shell>
  );
}
