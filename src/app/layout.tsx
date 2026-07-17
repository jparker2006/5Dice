import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import "./globals.css";

// Display: warm, characterful high-contrast serif — the gold wordmark + titles.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// UI: clean modern sans with tabular figures (the scorecard depends on them).
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "5 Dice",
  description: "Multiplayer dice with the family — roll, hold, score!",
  applicationName: "5 Dice",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "5 Dice",
  },
  icons: {
    icon: "/images/icon-192x192.png",
    apple: "/images/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#13201a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body>
        <SerwistProvider
          swUrl="/sw.js"
          disable={process.env.NODE_ENV === "development"}
        >
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
