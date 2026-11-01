// Plans: search by country, city or plan name, pick one.

import { plansForPartner } from "@roam/core";
import { getCore } from "../../lib/backend";
import { PlanSearch } from "./PlanSearch";
import { searchText } from "./search";
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
  const plans = all
    .filter((p) => !p.coverage.includes("ZZ"))
    .map((p) => ({
      id: p.id,
      href: withToken(`/esim/plan/${p.id}`, ctx.token),
      name: p.name,
      flag: flag(p.coverage),
      detail: `${dataLabel(p.data_mb)}${p.validity_days ? ` · ${p.validity_days} days` : ""}`,
      price: money({ display: p.price.display, currency: p.price.currency }),
      text: searchText(p),
    }));

  return (
    <Shell ctx={ctx} tab="plans">
      <h1 style={{ fontSize: 24 }}>Where are you going?</h1>
      <PlanSearch token={ctx.token} initial={q} plans={plans} />
      <p className="e-muted">Data only. Keep your home SIM on for calls, texts and bank codes.</p>
    </Shell>
  );
}
