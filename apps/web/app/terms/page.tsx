import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: "The terms for buying and using Roam Caller travel eSIMs.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage file="terms" title="Terms and Conditions" effective="3 April 2026" other={{ href: "/privacy", label: "Privacy Policy" }} />;
}
