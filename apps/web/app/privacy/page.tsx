import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Roam Caller collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage file="privacy" title="Privacy Policy" effective="3 April 2026" other={{ href: "/terms", label: "Terms and Conditions" }} />;
}
