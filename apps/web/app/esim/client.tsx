"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page's data every few seconds while an order is processing. */
export function Refresher({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="e-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Copy this code:", text);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
