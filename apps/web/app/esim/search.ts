// What a traveller might type for each country: its name, plus the short names,
// cities and trips people search for. Plans match on any country they cover.

const names = new Intl.DisplayNames(["en"], { type: "region" });

const AFRICA = new Set(
  "NG GH KE ZA EG MA TN SN CI CM UG TZ RW ET DZ AO BJ BF BI CV CF TD KM CD CG DJ GQ ER SZ GA GM GN GW LS LR LY MG MW ML MR MU MZ NA NE ST SC SL SO SS SD TG ZM ZW".split(" "),
);

const ALIASES: Record<string, string[]> = {
  GB: ["uk", "britain", "great britain", "england", "london", "scotland", "wales"],
  US: ["usa", "america", "united states of america", "new york", "atlanta", "houston"],
  AE: ["uae", "dubai", "abu dhabi", "emirates", "sharjah"],
  SA: ["ksa", "saudi", "mecca", "makkah", "medina", "madinah", "hajj", "umrah", "jeddah", "riyadh"],
  CN: ["guangzhou", "beijing", "shanghai", "shenzhen", "yiwu"],
  NG: ["lagos", "abuja", "naija"],
  GH: ["accra", "kumasi"],
  KE: ["nairobi", "mombasa"],
  ZA: ["south africa", "sa", "johannesburg", "joburg", "cape town", "durban"],
  EG: ["cairo", "egypt", "sharm el sheikh"],
  MA: ["marrakech", "marrakesh", "casablanca", "rabat"],
  CI: ["ivory coast", "abidjan"],
  SN: ["dakar"],
  CM: ["cameroun", "douala", "yaounde"],
  UG: ["kampala", "entebbe"],
  TN: ["tunis"],
  FR: ["paris"],
  TR: ["turkey", "turkiye", "istanbul"],
  CA: ["toronto", "vancouver", "montreal"],
};

/** All the words a plan can be found by, lower-cased. */
export function searchText(plan: { name: string; coverage: string[] }): string {
  const parts = [plan.name];
  for (const code of plan.coverage) {
    parts.push(code);
    try {
      parts.push(names.of(code) ?? "");
    } catch {
      // not a region code
    }
    parts.push(...(ALIASES[code] ?? []));
  }
  if (plan.coverage.length > 1) parts.push("regional", "multi-country");
  if (plan.coverage.some((c) => AFRICA.has(c))) parts.push("africa");
  return parts.join(" | ").toLowerCase();
}

export function matches(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Every word typed must appear somewhere: "saudi 10" finds "Saudi Arabia 10GB".
  return q.split(/\s+/).every((w) => text.includes(w));
}
