"use client";

import { useActionState, useState } from "react";
import { createPartnerAction, newKeyAction, signInAction, type Result } from "./actions";

function Secrets({ result }: { result: Result }) {
  if (!result) return null;
  if (!result.ok) return <p className="a-error" role="alert">{result.error}</p>;
  return (
    <div className="a-secret" role="status">
      <b>{result.title}</b>
      {result.secrets.map((s) => (
        <div key={s.label} className="a-secret-row">
          <small>{s.label}</small>
          <code>{s.value}</code>
          <CopyButton text={s.value} />
        </div>
      ))}
      <p>Copy these now: they are not stored and won't be shown again. Send them to the partner privately.</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="a-btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="a-card a-narrow">
      <h1>Roam Caller admin</h1>
      <label htmlFor="password">Admin password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button className="a-btn" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Secrets result={state} />
    </form>
  );
}

export function CreatePartnerForm() {
  const [state, action, pending] = useActionState(createPartnerAction, null);
  return (
    <form action={action} className="a-card">
      <h2>Add a partner</h2>
      <div className="a-grid">
        <div>
          <label htmlFor="name">Partner name</label>
          <input id="name" name="name" placeholder="e.g. Cleva" required maxLength={80} />
        </div>
        <div>
          <label htmlFor="currency">Currency</label>
          <select id="currency" name="currency" defaultValue="USD">
            <option value="USD">USD (US dollars)</option>
            <option value="NGN">NGN (Naira)</option>
          </select>
        </div>
        <div>
          <label htmlFor="markup">Markup over cost (%)</label>
          <input id="markup" name="markup" type="number" min={0} max={200} step={0.5} defaultValue={20} required />
        </div>
        <div>
          <label htmlFor="webhook_url">Webhook address (optional)</label>
          <input id="webhook_url" name="webhook_url" type="url" placeholder="https://partner.com/roamcaller/webhooks" />
        </div>
      </div>
      <button className="a-btn" disabled={pending}>
        {pending ? "Creating…" : "Create partner and sandbox key"}
      </button>
      <Secrets result={state} />
    </form>
  );
}

export function NewKeyForm({ partnerId }: { partnerId: string }) {
  const [state, action, pending] = useActionState(newKeyAction, null);
  return (
    <form action={action} className="a-inline">
      <input type="hidden" name="partner_id" value={partnerId} />
      <button className="a-btn small secondary" disabled={pending}>
        {pending ? "Creating…" : "New sandbox key"}
      </button>
      <Secrets result={state} />
    </form>
  );
}

/** Two clicks to revoke, so a key isn't switched off by accident. */
export function RevokeButton({ action, keyId }: { action: (form: FormData) => Promise<void>; keyId: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="a-link" onClick={() => setArmed(true)}>
        Revoke
      </button>
    );
  }
  return (
    <form action={action} className="a-inline">
      <input type="hidden" name="key_id" value={keyId} />
      <button className="a-link danger">Confirm revoke</button>
      <button type="button" className="a-link" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </form>
  );
}
