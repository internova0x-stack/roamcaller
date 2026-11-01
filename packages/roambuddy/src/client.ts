// Client for the RoamBuddy white-label partner API
// (docs: https://roambuddy-partner.apidog.io/llms.txt).
//
// The docs document request bodies but leave every response schema empty, so this
// client returns the parsed JSON as `unknown`. Field extraction lives in extract.ts,
// in one place, until RoamBuddy confirms the shapes (docs/ROAMBUDDY.md).

export type AuthScheme = "raw" | "bearer";

export interface RoamBuddyConfig {
  baseUrl: string;
  username: string;
  password: string;
  authScheme?: AuthScheme;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class RoamBuddyError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(message);
    this.name = "RoamBuddyError";
  }

  /** True when the request may not have reached RoamBuddy or it failed on their side. */
  get retryable(): boolean {
    return this.status === null || this.status >= 500;
  }
}

type Method = "GET" | "POST";

export class RoamBuddyClient {
  private token: string | null = null;
  private login: Promise<string> | null = null;
  private readonly cfg: Required<Omit<RoamBuddyConfig, "fetch">> & { fetch: typeof fetch };

  constructor(cfg: RoamBuddyConfig) {
    this.cfg = {
      authScheme: "raw",
      timeoutMs: 20_000,
      fetch: globalThis.fetch,
      ...cfg,
      baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
    };
  }

  // ---- Account ----
  authenticate(): Promise<unknown> {
    return this.send("POST", "/wl-account/authenticate", {
      body: { username: this.cfg.username, password: this.cfg.password },
      auth: false,
    });
  }

  // ---- Wallet ----
  wallet(): Promise<unknown> {
    return this.request("GET", "/wallet");
  }

  // ---- Products ----
  products(): Promise<unknown> {
    return this.request("GET", "/products/all");
  }

  product(planId: number): Promise<unknown> {
    return this.request("GET", `/products/${planId}`);
  }

  countries(): Promise<unknown> {
    return this.request("GET", "/whitelabel-dashboard/countries");
  }

  // ---- Orders ----
  // POSTs are never retried here: RoamBuddy documents no idempotency key, so a
  // retry after a timeout could buy a second eSIM. The order engine decides instead.
  requestOrder(planId: number): Promise<unknown> {
    return this.request("POST", "/products/orders/request", { body: { plan_id: planId } });
  }

  completeOrder(orderId: string): Promise<unknown> {
    return this.request("POST", "/products/orders/complete", { body: { order_id: orderId } });
  }

  cancelOrder(orderId: string, reason: string): Promise<unknown> {
    return this.request("POST", "/products/orders/cancel", { body: { order_id: orderId, reason } });
  }

  order(orderId: string): Promise<unknown> {
    return this.request("GET", `/products/orders/${encodeURIComponent(orderId)}`);
  }

  // ---- eSIMs ----
  esimDetails(iccid: string): Promise<unknown> {
    return this.request("GET", `/whitelabel-dashboard/esims/details/${encodeURIComponent(iccid)}`);
  }

  validateEsim(iccid: string): Promise<unknown> {
    return this.request("GET", `/products/esim/validate/${encodeURIComponent(iccid)}`);
  }

  activateEsim(iccid: string): Promise<unknown> {
    return this.request("POST", "/products/esim/activate", { body: { iccid } });
  }

  // ---- Top-ups ----
  topupPackages(iccid: string): Promise<unknown> {
    return this.request("GET", `/topup/packages/${encodeURIComponent(iccid)}`);
  }

  applyTopup(iccid: string, planId: number): Promise<unknown> {
    return this.request("POST", "/topup/apply", { body: { iccid, plan_id: planId } });
  }

  // ---- internals ----

  private async request(method: Method, path: string, opts: { body?: unknown } = {}): Promise<unknown> {
    const attempts = method === "GET" ? 3 : 1;
    for (let i = 0; ; i++) {
      try {
        return await this.send(method, path, { ...opts, auth: true });
      } catch (err) {
        if (err instanceof RoamBuddyError && err.status === 401 && this.token) {
          // Token revoked or expired: log in again once.
          this.token = null;
          return this.send(method, path, { ...opts, auth: true });
        }
        if (i + 1 >= attempts || !(err instanceof RoamBuddyError) || !err.retryable) throw err;
        await new Promise((r) => setTimeout(r, 300 * 2 ** i));
      }
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    this.login ??= this.authenticate()
      .then((res) => {
        const token = findToken(res);
        if (!token) throw new RoamBuddyError("Login response had no token", 200, res, "/wl-account/authenticate");
        this.token = token;
        return token;
      })
      .finally(() => {
        this.login = null;
      });
    return this.login;
  }

  private async send(method: Method, path: string, opts: { body?: unknown; auth: boolean }): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (opts.auth) {
      const token = await this.accessToken();
      headers.Authorization = this.cfg.authScheme === "bearer" ? `Bearer ${token}` : token;
    }
    let res: Response;
    try {
      res = await this.cfg.fetch(this.cfg.baseUrl + path, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new RoamBuddyError(`RoamBuddy ${method} ${path} failed: ${(err as Error).message}`, null, null, path);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    if (!res.ok) throw new RoamBuddyError(`RoamBuddy ${method} ${path} returned ${res.status}`, res.status, body, path);
    return body;
  }
}

function findToken(res: unknown): string | null {
  // Assumption until RoamBuddy confirms the login response (docs/ROAMBUDDY.md, Q3).
  const r = res as Record<string, any> | null;
  const candidates = [r?.token, r?.access_token, r?.accessToken, r?.data?.token, r?.data?.access_token, r?.data?.accessToken];
  return candidates.find((c): c is string => typeof c === "string" && c.length > 0) ?? null;
}

/** What the rest of the system uses: the real client, or the fake one in fake.ts. */
export type RoamBuddyApi = Pick<
  RoamBuddyClient,
  | "authenticate"
  | "wallet"
  | "products"
  | "product"
  | "countries"
  | "requestOrder"
  | "completeOrder"
  | "cancelOrder"
  | "order"
  | "esimDetails"
  | "validateEsim"
  | "activateEsim"
  | "topupPackages"
  | "applyTopup"
>;
