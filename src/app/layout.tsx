import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "5 Dice",
  description: "Serverless multiplayer dice — rebuilt on Next.js + PartyKit.",
};

export const viewport: Viewport = {
  themeColor: "#1a2a40",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
