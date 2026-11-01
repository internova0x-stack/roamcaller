"use client";

// Filters the plan list as the traveller types. The form still submits (Search button
// or Enter) for browsers without JavaScript.

import { useMemo, useState } from "react";
import { matches } from "./search";

export interface SearchPlan {
  id: string;
  href: string;
  name: string;
  flag: string;
  detail: string;
  price: string;
  text: string;
  /** How many countries the plan covers: single-country plans are listed first when searching. */
  countries: number;
}

export function PlanSearch(props: { token: string; initial: string; plans: SearchPlan[] }) {
  const [q, setQ] = useState(props.initial);
  const shown = useMemo(() => {
    const hits = props.plans.filter((p) => matches(p.text, q));
    // While searching, the country's own plan first, then regional, then global (stable within each).
    return q.trim() ? [...hits].sort((a, b) => a.countries - b.countries) : hits;
  }, [props.plans, q]);

  return (
    <>
      <form className="e-search" action="/esim" method="get" role="search">
        <input type="hidden" name="t" value={props.token} />
        <input
          id="q"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Country or city, e.g. UK, Dubai"
          aria-label="Search destinations"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button className="e-btn secondary" style={{ width: "auto", padding: "12px 16px" }} type="submit">
          Search
        </button>
      </form>
      {shown.length ? (
        <ul className="e-list" aria-live="polite">
          {shown.map((p) => (
            <li key={p.id}>
              <a className="e-plan" href={p.href}>
                <span className="e-flag" aria-hidden="true">
                  {p.flag}
                </span>
                <span className="txt">
                  <b>{p.name}</b>
                  <span className="e-muted">{p.detail}</span>
                </span>
                <span className="price">{p.price}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="e-card e-empty" aria-live="polite">
          <b>No plans for “{q.trim()}” yet.</b>
          <span className="e-muted">Try a country name, such as United Kingdom, or a city, such as Dubai.</span>
          <button type="button" className="e-btn secondary" onClick={() => setQ("")}>
            Show all plans
          </button>
        </div>
      )}
    </>
  );
}
