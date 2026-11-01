import { FakeRoamBuddy, RoamBuddyClient, type AuthScheme, type RoamBuddyApi } from "@roam/roambuddy";
import type { Mode } from "@roam/db";

/** Gives the RoamBuddy client for a mode: test → sandbox account, live → live account. */
export type RoamBuddyFor = (mode: Mode) => RoamBuddyApi;

/**
 * Test mode uses the real RoamBuddy sandbox when ROAMBUDDY_SANDBOX_URL is set, and the
 * built-in fake otherwise (demos and partner sandboxes). Live mode always needs real credentials.
 */
export function roamBuddyFromEnv(env: NodeJS.ProcessEnv = process.env): RoamBuddyFor {
  const clients = new Map<Mode, RoamBuddyApi>();
  return (mode) => {
    let c = clients.get(mode);
    if (!c) {
      const prefix = mode === "live" ? "ROAMBUDDY_LIVE" : "ROAMBUDDY_SANDBOX";
      const baseUrl = env[`${prefix}_URL`];
      const username = env[`${prefix}_USERNAME`];
      const password = env[`${prefix}_PASSWORD`];
      if (mode === "test" && !baseUrl) {
        c = new FakeRoamBuddy();
      } else {
        if (!baseUrl || !username || !password) throw new Error(`${prefix}_URL, _USERNAME and _PASSWORD must be set`);
        c = new RoamBuddyClient({ baseUrl, username, password, authScheme: (env.ROAMBUDDY_AUTH_SCHEME as AuthScheme) ?? "raw" });
      }
      clients.set(mode, c);
    }
    return c;
  };
}
