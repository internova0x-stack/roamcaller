import type { Metadata } from "next";
import LegalPage from "../LegalPage";

export const metadata: Metadata = {
  title: "API documentation",
  description: "The Roam Caller partner API: sell travel eSIMs for 108+ countries inside your product.",
  // Shared with partners directly; kept out of search engines and not linked from the site.
  robots: { index: false, follow: false },
};

// Rendered from the repo's docs/API.md, so the page and the file never disagree.
export default function DocsPage() {
  return (
    <LegalPage
      file="../../docs/API.md"
      title="Partner API"
      subtitle="Sandbox: https://www.roamcaller.com/api/v1 · Live demo: www.roamcaller.com/demo"
      other={{ href: "/demo", label: "Partner demo" }}
    />
  );
}
