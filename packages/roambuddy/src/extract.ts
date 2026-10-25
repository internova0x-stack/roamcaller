// Turns RoamBuddy responses into our own shapes.
//
// ASSUMPTIONS: RoamBuddy's docs leave every response schema empty. Each function
// below lists the field names it accepts; they are guesses until the first sandbox
// order shows the real shapes (docs/ROAMBUDDY.md). When that happens, narrow the
// candidates here and update the mock to match. Nothing outside this file should
// read RoamBuddy response fields directly. Callers always keep the raw response too.

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** RoamBuddy may wrap payloads in `data` or `result`. */
function unwrap(res: unknown): unknown {
  let cur = res;
  for (let i = 0; i < 2 && isObj(cur); i++) {
    const inner = cur.data ?? cur.result;
    if (inner === undefined) break;
    cur = inner;
  }
  return cur;
}

function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export interface RbPlan {
  rbPlanId: number;
  name: string;
  coverage: string[];
  dataMb: number | null;
  validityDays: number | null;
  costUsdCents: number | null;
  raw: unknown;
}

export function extractPlans(res: unknown): RbPlan[] {
  const body = unwrap(res);
  const list = Array.isArray(body) ? body : isObj(body) ? (pick(body, ["products", "plans", "rows", "items"]) as unknown) : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p) => {
    if (!isObj(p)) return [];
    const id = num(pick(p, ["plan_id", "id", "product_id"]));
    if (id === null) return [];
    const gb = num(pick(p, ["data_gb", "gb", "data"]));
    const mb = num(pick(p, ["data_mb", "mb"])) ?? (gb === null ? null : Math.round(gb * 1024));
    const price = num(pick(p, ["price_usd", "price", "cost", "amount"]));
    const cov = pick(p, ["countries", "country_codes", "coverage", "country", "region"]);
    return [
      {
        rbPlanId: id,
        name: str(pick(p, ["name", "plan_name", "title"])) ?? `Plan ${id}`,
        coverage: Array.isArray(cov) ? cov.map((c) => str(isObj(c) ? pick(c, ["code", "iso", "name"]) : c)).filter((c): c is string => !!c) : str(cov) ? [str(cov)!] : [],
        dataMb: mb,
        validityDays: num(pick(p, ["validity_days", "validity", "days", "duration"])),
        costUsdCents: price === null ? null : Math.round(price * 100),
        raw: p,
      },
    ];
  });
}

/** The RoamBuddy order id from orders/request (docs example: "SM-107"). */
export function extractOrderId(res: unknown): string | null {
  const body = unwrap(res);
  if (!isObj(body)) return null;
  const order = isObj(body.order) ? body.order : body;
  return str(pick(order, ["order_id", "orderId", "id"]));
}

export interface RbInstall {
  iccid: string;
  /** Full LPA string, e.g. "LPA:1$smdp.example.com$ABC123". */
  lpa: string | null;
  smdpAddress: string | null;
  activationCode: string | null;
  qrUrl: string | null;
}

/** eSIM install details from an order or eSIM-details response. */
export function extractInstall(res: unknown): RbInstall | null {
  const body = unwrap(res);
  if (!isObj(body)) return null;
  const esimList = pick(body, ["esims", "esim"]);
  const esim = Array.isArray(esimList) ? esimList[0] : esimList;
  const e = isObj(esim) ? esim : body;
  const iccid = str(pick(e, ["iccid", "ICCID"]));
  if (!iccid) return null;
  let lpa = str(pick(e, ["lpa", "lpa_string", "lpaString", "qr_code_text", "activation_string"]));
  let smdp = str(pick(e, ["smdp_address", "smdpAddress", "smdp", "sm_dp_address"]));
  let code = str(pick(e, ["activation_code", "activationCode", "matching_id", "matchingId"]));
  if (lpa?.startsWith("LPA:1$")) {
    const [, s, c] = lpa.split("$");
    smdp ??= s ?? null;
    code ??= c ?? null;
  } else if (!lpa && smdp && code) {
    lpa = `LPA:1$${smdp}$${code}`;
  }
  return { iccid, lpa, smdpAddress: smdp, activationCode: code, qrUrl: str(pick(e, ["qr_code", "qrCode", "qr_url", "qr"])) };
}

export interface RbUsage {
  dataTotalMb: number | null;
  dataUsedMb: number | null;
  expiresAt: string | null;
  status: string | null;
}

export function extractUsage(res: unknown): RbUsage {
  const body = unwrap(res);
  const e = isObj(body) ? body : {};
  return {
    dataTotalMb: num(pick(e, ["data_total_mb", "total_mb", "total_data"])),
    dataUsedMb: num(pick(e, ["data_used_mb", "used_mb", "used_data"])),
    expiresAt: str(pick(e, ["expires_at", "expiry_date", "expired_at", "valid_until"])),
    status: str(pick(e, ["status", "esim_status", "state"])),
  };
}

/** Wallet balance in US cents. */
export function extractWalletCents(res: unknown): number | null {
  const body = unwrap(res);
  const v = isObj(body) ? pick(isObj(body.wallet) ? body.wallet : body, ["wallet_balance", "balance", "amount"]) : body;
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

export type RbOrderStatus = "open" | "completed" | "cancelled" | "unknown";

/**
 * Where a RoamBuddy order stands. Anything we don't recognise is "unknown", which
 * makes the order engine wait for a person instead of guessing. Never "open" by
 * default: treating a completed order as open could cancel and refund a paid eSIM.
 */
export function extractOrderStatus(res: unknown): RbOrderStatus {
  const body = unwrap(res);
  if (!isObj(body)) return "unknown";
  if (extractInstall(res)) return "completed";
  const order = isObj(body.order) ? body.order : body;
  const s = str(pick(order, ["status", "order_status", "state"]))?.toLowerCase();
  if (!s) return "unknown";
  if (/cancel|refund|void|reject/.test(s)) return "cancelled";
  if (/complet|success|deliver|done|paid|active/.test(s)) return "completed";
  if (/pend|request|creat|new|open|await|process|reserv/.test(s)) return "open";
  return "unknown";
}
