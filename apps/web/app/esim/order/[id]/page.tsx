// After paying: the order's status, then everything needed to install the eSIM.

import QRCode from "qrcode";
import { getOrderView, toApiOrder } from "@roam/core";
import { getCore } from "../../../../lib/backend";
import { CopyButton, Refresher } from "../../client";
import { Expired, loadCtx, money, Shell, withToken } from "../../ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function OrderPage({ params, searchParams }: Props) {
  const ctx = await loadCtx(searchParams);
  if (!ctx) return <Expired />;
  const { id } = await params;

  const view = /^[0-9a-f-]{36}$/.test(id) ? await getOrderView(getCore().db, id) : null;
  const mine =
    view && view.order.partnerId === ctx.partner.id && view.order.mode === ctx.session.mode && view.order.customerRef === ctx.session.customerRef;
  if (!view || !mine) {
    return (
      <Shell ctx={ctx} tab="mine">
        <div className="e-card e-empty">
          <b>We couldn't find this eSIM.</b>
          <a href={withToken("/esim/mine", ctx.token)}>See my eSIMs</a>
        </div>
      </Shell>
    );
  }
  const order = toApiOrder(view);
  const install = order.esim?.install;
  const qr = install?.lpa ? await QRCode.toString(install.lpa, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <Shell ctx={ctx} tab="mine">
      <a className="e-back" href={withToken("/esim/mine", ctx.token)}>
        ← My eSIMs
      </a>
      <div className="e-card">
        <h1 style={{ fontSize: 22 }}>{order.plan.name}</h1>
        <span className="e-muted">
          {money(order.price)} · {new Date(order.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
        {order.status === "delivered" ? <span className="e-chip good">✓ Ready to install</span> : null}
        {order.status === "processing" ? <span className="e-chip wait">Getting your eSIM…</span> : null}
        {order.status === "failed" || order.status === "cancelled" ? (
          <span className="e-chip bad">{order.status === "failed" ? "We couldn't get this eSIM" : "Cancelled"}</span>
        ) : null}
      </div>

      {order.status === "processing" ? (
        <div className="e-card e-empty">
          <div className="e-spin" aria-hidden="true" />
          <b>Getting your eSIM</b>
          <span className="e-muted">This usually takes a few seconds. You can leave this screen; it will be in My eSIMs.</span>
          <Refresher />
        </div>
      ) : null}

      {order.status === "failed" ? (
        <div className="e-card">
          <b>You haven't been charged.</b>
          <span className="e-muted">Please try again, or choose another plan.</span>
          <a className="e-btn secondary" href={withToken("/esim", ctx.token)}>
            Back to plans
          </a>
        </div>
      ) : null}

      {order.status === "delivered" && install ? (
        <>
          <div className="e-card">
            <h2 style={{ fontSize: 18 }}>Install on this iPhone</h2>
            {install.ios_install_url ? (
              <a className="e-btn" href={install.ios_install_url} target="_blank" rel="noreferrer">
                Install eSIM
              </a>
            ) : null}
            <span className="e-muted">Works on iOS 17.4 and later. Install on Wi-Fi, ideally before you travel.</span>
          </div>

          {qr ? (
            <div className="e-card">
              <h2 style={{ fontSize: 18 }}>Or scan the QR code</h2>
              <div className="e-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <ol className="e-steps">
                <li>
                  iPhone: Settings → Mobile Service → Add eSIM → Use QR Code
                </li>
                <li>
                  Android: Settings → Network & internet → SIMs → Add eSIM
                </li>
              </ol>
              <span className="e-muted">Scan it from another screen. An eSIM can usually be installed only once, so keep this code private.</span>
            </div>
          ) : null}

          <div className="e-card">
            <h2 style={{ fontSize: 18 }}>Or enter the codes by hand</h2>
            {install.smdp_address ? (
              <div className="e-code">
                <div>
                  <small>SM-DP+ address</small>
                  <code>{install.smdp_address}</code>
                </div>
                <CopyButton text={install.smdp_address} />
              </div>
            ) : null}
            {install.activation_code ? (
              <div className="e-code">
                <div>
                  <small>Activation code</small>
                  <code>{install.activation_code}</code>
                </div>
                <CopyButton text={install.activation_code} />
              </div>
            ) : null}
          </div>

          <div className="e-card">
            <h2 style={{ fontSize: 18 }}>When you land</h2>
            <ol className="e-steps">
              <li>Turn on the Roam Caller line.</li>
              <li>Turn on data roaming for that line only.</li>
              <li>Keep your home SIM on for calls, texts and bank codes.</li>
            </ol>
          </div>
        </>
      ) : null}
    </Shell>
  );
}
