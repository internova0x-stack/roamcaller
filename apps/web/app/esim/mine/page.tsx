// My eSIMs: everything this traveller has bought, newest first, with data used.

import { customerOrders, toApiOrder } from "@roam/core";
import { getCore } from "../../../lib/backend";
import { dataLabel, Expired, loadCtx, Shell, withToken } from "../ui";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS: Record<string, { label: string; tone: string }> = {
  delivered: { label: "Ready", tone: "good" },
  processing: { label: "Processing", tone: "wait" },
  failed: { label: "Failed · not charged", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export default async function MinePage({ searchParams }: Props) {
  const ctx = await loadCtx(searchParams);
  if (!ctx) return <Expired />;
  const views = await customerOrders(getCore().db, { partnerId: ctx.partner.id, mode: ctx.session.mode, customerRef: ctx.session.customerRef });
  const list = views.map(toApiOrder);

  return (
    <Shell ctx={ctx} tab="mine">
      <h1 style={{ fontSize: 24 }}>My eSIMs</h1>
      {list.length === 0 ? (
        <div className="e-card e-empty">
          <b>No eSIMs yet</b>
          <span className="e-muted">Buy a plan before your trip and it will appear here.</span>
          <a className="e-btn" href={withToken("/esim", ctx.token)}>
            Browse plans
          </a>
        </div>
      ) : (
        <ul className="e-list">
          {list.map((o) => {
            const s = STATUS[o.status] ?? STATUS.processing!;
            const total = o.esim?.data_total_mb ?? null;
            const used = o.esim?.data_used_mb ?? null;
            const share = total && used !== null ? Math.min(100, Math.round((used / total) * 100)) : null;
            return (
              <li key={o.id}>
                <a className="e-card" href={withToken(`/esim/order/${o.id}`, ctx.token)} style={{ textDecoration: "none", color: "inherit" }}>
                  <b style={{ fontSize: 16 }}>{o.plan.name}</b>
                  <span className={`e-chip ${s.tone}`}>{s.label}</span>
                  {share !== null ? (
                    <>
                      <div className="e-bar" aria-label={`${share}% of data used`}>
                        <i style={{ width: `${share}%` }} />
                      </div>
                      <span className="e-muted">
                        {dataLabel(total! - used!)} left of {dataLabel(total)}
                      </span>
                    </>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
