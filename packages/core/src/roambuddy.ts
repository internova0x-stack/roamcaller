import { RoamBuddyClient, type AuthScheme } from "@roam/roambuddy";
import type { Mode } from "@roam/db";

/** Gives the RoamBuddy client for a mode: test → sandbox account, live → live account. */
export type RoamBuddyFor = (mode: Mode) => RoamBuddyClient;

export function roamBuddyFromEnv(env: NodeJS.ProcessEnv = process.env): RoamBuddyFor {
  const clients = new Map<Mode, RoamBuddyClient>();
  return (mode) => {
    let c = clients.get(mode);
    if (!c) {
      const prefix = mode === "live" ? "ROAMBUDDY_LIVE" : "ROAMBUDDY_SANDBOX";
      const baseUrl = env[`${prefix}_URL`];
      const username = env[`${prefix}_USERNAME`];
      const password = env[`${prefix}_PASSWORD`];
      if (!baseUrl || !username || !password) throw new Error(`${prefix}_URL, _USERNAME and _PASSWORD must be set`);
      c = new RoamBuddyClient({ baseUrl, username, password, authScheme: (env.ROAMBUDDY_AUTH_SCHEME as AuthScheme) ?? "raw" });
      clients.set(mode, c);
    }
    return c;
  };
}
