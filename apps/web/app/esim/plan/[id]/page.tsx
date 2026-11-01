// One plan: what it includes, and the button that buys it.

import { randomUUID } from "node:crypto";
import { plansForPartner } from "@roam/core";
import { getCore } from "../../../../lib/backend";
import { buyPlan } from "../../actions";
import { dataLabel, Expired, flag, loadCtx, money, Shell, withToken } from "../../ui";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  insufficient_balance: "This purchase can't be completed right now. Please try again later or contact support.",
  plan_not_found: "This plan is no longer available. Please choose another.",
  partner_paused: "Travel eSIMs are unavailable right now.",
  pricing_unavailable: "Prices are being updated. Please try again in a few minutes.",
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PlanPage({ params, searchParams }: Props) {
  const ctx = await loadCtx(searchParams);
  if (!ctx) return <Expired />;
  const { id } = await params;
  const errRaw = (await searchParams).error;
  const err = Array.isArray(errRaw) ? errRaw[0] : errRaw;

  const plan = (await plansForPartner(getCore().db, ctx.partner, ctx.session.mode)).find((p) => p.id === id);
  if (!plan) {
    return (
      <Shell ctx={ctx} tab="plans">
        <div className="e-card e-empty">
          <b>This plan is no longer available.</b>
          <a href={withToken("/esim", ctx.token)}>See all plans</a>
        </div>
      </Shell>
    );
  }
  const price = money({ display: plan.price.display, currency: plan.price.currency });

  return (
    <Shell ctx={ctx} tab="plans">
      <a className="e-back" href={withToken("/esim", ctx.token)}>
        ← All plans
      </a>
      <div className="e-card">
        <span className="e-flag" style={{ fontSize: 40, width: "auto", textAlign: "left" }} aria-hidden="true">
          {flag(plan.coverage)}
        </span>
        <h1 style={{ fontSize: 24 }}>{plan.name}</h1>
        <div className="e-facts">
          <div>
            <b>{dataLabel(plan.data_mb)}</b>
            <span>data</span>
          </div>
          <div>
            <b>{plan.validity_days ?? "—"}</b>
            <span>days</span>
          </div>
          <div>
            <b>{plan.coverage.length}</b>
            <span>{plan.coverage.length === 1 ? "country" : "countries"}</span>
          </div>
        </div>
        <ul className="e-steps">
          <li>The days start when you first connect at your destination.</li>
          <li>Data only: keep your home SIM on for calls and bank codes.</li>
          <li>Hotspot allowed. Top up any time.</li>
        </ul>
      </div>

      {err ? (
        <div className="e-alert bad" role="alert">
          {ERRORS[err] ?? "Something went wrong. Please try again."}
        </div>
      ) : null}

      <form action={buyPlan}>
        <input type="hidden" name="t" value={ctx.token} />
        <input type="hidden" name="plan_id" value={plan.id} />
        <input type="hidden" name="idem" value={randomUUID()} />
        <button className="e-btn" type="submit">
          Pay {price}
        </button>
      </form>
      <p className="e-muted" style={{ textAlign: "center", margin: 0 }}>
        Charged to your {ctx.partner.name} balance. Your phone must support eSIM: dial *#06# and look for an EID.
      </p>
    </Shell>
  );
}
