import type { Metadata, Viewport } from "next";
import "./legal.css";

// The landing page is a static file (public/landing.html). This layout wraps the
// React pages: /privacy and /terms for now, the eSIM screens later.

export const metadata: Metadata = {
  metadataBase: new URL("https://roamcaller.com"),
  title: { default: "Roam Caller", template: "%s · Roam Caller" },
  description: "Roam Caller: data for every trip. Travel eSIMs for 108+ countries.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Inter:wght@700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
