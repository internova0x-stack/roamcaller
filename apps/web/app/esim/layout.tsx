import type { Metadata } from "next";
import "./esim.css";

export const metadata: Metadata = {
  title: "Travel eSIM",
  robots: { index: false, follow: false },
};

export default function EsimLayout({ children }: { children: React.ReactNode }) {
  return children;
}
